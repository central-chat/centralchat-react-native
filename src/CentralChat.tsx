// Central Chat — React Native.
//
//   CentralChat.init(entry)   warms everything
//   CentralChat.show()        reveals it
//   CentralChat.hide()        puts it away
//
// `entry` is the one thing the app supplies, and it names both the line and the
// visitor. See `CentralChat.init`.
//
// Mount <CentralChatHost/> ONCE, high in your tree — above whatever navigator
// you use, so it is never unmounted. That is what keeps the chat warm: the
// WebView is created on the first init and lives as long as the app does, so
// show() has nothing left to fetch.
//
//   export default function App() {
//     return (
//       <>
//         <YourNavigator />
//         <CentralChatHost />
//       </>
//     );
//   }
//
// Permissions, for the composer's own buttons. Declare only what your line
// offers; an undeclared use is simply never asked for.
//   android/app/src/main/AndroidManifest.xml
//     INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS   voice messages
//     ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION    a shared location
//     (no CAMERA: declaring it makes Android enforce it for the camera
//      intent, which is the one thing it looks like it would enable)
//   ios/<app>/Info.plist
//     NSMicrophoneUsageDescription, NSCameraUsageDescription,
//     NSPhotoLibraryUsageDescription, NSLocationWhenInUseUsageDescription
import {useEffect, useRef, useState} from 'react';
import {Linking, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {WebView} from 'react-native-webview';

const DEFAULT_CONTAINER_URL = 'https://web.central.chat/widget/container.html';

// Generous against a cold renderer on a slow network. It is the backstop for
// every failure the layers below cannot see: without it a dropped handshake
// leaves the host with no success and no failure, forever.
const READY_TIMEOUT_MS = 20_000;

export type CentralChatErrorCode =
  | 'ENTRY_INVALID'
  | 'TOKEN_EXPIRED'
  | 'NETWORK'
  | 'INTERNAL';

export interface CentralChatError {
  code: CentralChatErrorCode;
  message: string;
}

/**
 * Where the chat keeps its session token and this device's encryption keys.
 *
 * Optional, and there is no dependency here on any particular one: hand over
 * whatever secure store your app already has — `expo-secure-store`,
 * `react-native-keychain`, your own native module. Give none and the chat keeps
 * the WebView's encrypted storage, which is what it always did.
 *
 * Why bother: WebView data is the app's to delete, and history is encrypted to
 * devices — so a "clear app data" does not merely sign the visitor out, it
 * drops the keys that made their thread readable. A keychain is not WebView
 * data.
 *
 * `list` must answer FULL keys, not the part after the prefix. A store with no
 * prefix search of its own needs an index beside the values; iOS's Keychain and
 * Android's EncryptedSharedPreferences both enumerate, so most wrappers expose
 * it directly.
 */
export interface CentralChatSecureStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
  list(prefix: string): Promise<string[]> | string[];
  /**
   * Optional, and worth having: a boot reads sixty-odd keys, and without this
   * that is sixty round trips over the bridge before the first frame. Left out,
   * the four above answer the batch one call at a time.
   */
  getMany?(keys: string[]): Promise<Array<string | null>> | Array<string | null>;
  setMany?(entries: Array<[string, string]>): Promise<void> | void;
}

// The state the host screen never sees. It lives at module scope rather than in
// the component because the chat must outlive every screen that shows it.
const state: {
  entryInUse?: string;
  shown: boolean;
  resolved: boolean;
  retried: boolean;
  notify?: () => void;
} = {shown: false, resolved: false, retried: false};

let timer: ReturnType<typeof setTimeout> | undefined;
let secureStore: CentralChatSecureStore | undefined;

/**
 * Answer one storage request from the page.
 *
 * A store that throws is reported as a refusal rather than as an empty value:
 * a keychain that cannot answer has told the truth, and an empty answer would
 * read as "no session" and silently sign the visitor out.
 */
async function answerStorage(
  request: {rid?: string; payload?: Record<string, string>},
  send: (js: string) => void,
): Promise<void> {
  const {rid, payload} = request;
  if (!rid || !payload || !secureStore) return;
  const reply = (ok: boolean, body: unknown) =>
    send(`CentralChat.storageResult(${JSON.stringify(rid)},${ok},${JSON.stringify(body)})`);
  try {
    switch (payload.op) {
      case 'get':
        reply(true, {value: (await secureStore.get(payload.key ?? '')) ?? null});
        return;
      case 'getMany': {
        const keys = (payload.keys as unknown as string[]) ?? [];
        const values = secureStore.getMany
          ? await secureStore.getMany(keys)
          : await Promise.all(keys.map(async (key) => (await secureStore!.get(key)) ?? null));
        // Positional and exactly as long as what was asked for: a store that
        // answers short would have its tail read as `undefined` by the page.
        reply(true, {values: keys.map((_, index) => values[index] ?? null)});
        return;
      }
      case 'setMany': {
        const entries = (payload.entries as unknown as Array<[string, string]>) ?? [];
        if (secureStore.setMany) await secureStore.setMany(entries);
        else for (const [key, value] of entries) await secureStore.set(key, value);
        reply(true, {});
        return;
      }
      case 'set':
        await secureStore.set(payload.key ?? '', payload.value ?? '');
        reply(true, {});
        return;
      case 'remove':
        await secureStore.remove(payload.key ?? '');
        reply(true, {});
        return;
      case 'list':
        reply(true, {keys: await secureStore.list(payload.prefix ?? '')});
        return;
      default:
        reply(false, 'unknown storage op');
    }
  } catch (error) {
    reply(false, error instanceof Error ? error.message : 'storage failed');
  }
}

function render(): void {
  state.notify?.();
}

/**
 * The whole public surface.
 */
export const CentralChat = {
  /** Optional. Set it once if you want to hear about failures. */
  onError: undefined as ((error: CentralChatError) => void) | undefined,

  /** Optional. Fires once per init(), when the chat is warm and ready to show. */
  onReady: undefined as (() => void) | undefined,

  /**
   * The page the WebView loads. Set it before the first init() to point at a
   * staging tier; the default is the production one and needs no configuration.
   */
  containerUrl: DEFAULT_CONTAINER_URL,

  /**
   * Hand the chat your app's secure store. Set it BEFORE the first init(): the
   * page is told once, as it mounts, and a store that arrives later would not
   * be asked for the session it was supposed to hold.
   */
  useSecureStore(store: CentralChatSecureStore): void {
    secureStore = store;
  },

  /**
   * Warms the chat. Call it as early as you have an entry — app start is right.
   *
   * `entry` is either door:
   *  - `"<businessId>|<chatAccountId>"` — an **anonymous** visitor on that line.
   *    Both ids are public; nothing is signed and no backend of yours is in the
   *    loop. A line configured `onlyValidatedUsers` refuses this door.
   *  - an **App Entry JWT** your backend minted — a **verified** visitor. The
   *    line comes out of the token's `bid`/`cid` protected header, so the ids
   *    are not passed separately. A token always wins over the ids.
   *
   * `|` is not in the base64url alphabet a JWT is spelled with, so the two can
   * never be confused.
   *
   * Idempotent by design: the host may call this on every launch, and
   * re-entering an identical session would throw away a warm thread for
   * nothing. Only a DIFFERENT entry is a different person, and that does
   * re-enter.
   */
  init(entry: string): void {
    // Refused, never thrown: an entry is a value that arrives at runtime — a
    // mint your backend returned, a key somebody pasted — and a library that
    // throws out of the host's own start-up turns their bad input into your
    // crash. ENTRY_INVALID is the same answer the page gives for every other
    // entry it will not take, so a host handles one case.
    if (!entry || entry.startsWith('|') || entry.endsWith('|')) {
      refuse('not an App Entry jwt or a businessId|chatAccountId');
      return;
    }
    if (entry === state.entryInUse) {
      if (state.resolved) CentralChat.onReady?.();
      return;
    }
    state.entryInUse = entry;
    state.resolved = false;
    state.retried = false;
    restartTimeout();
    render();
  },

  /** The anonymous door, spelled out: the same as init() with the two ids joined by a pipe. */
  initAnonymous(businessId: string, chatAccountId: string): void {
    CentralChat.init(`${businessId}|${chatAccountId}`);
  },

  /**
   * Presents the warm chat. Nothing is fetched here — that already happened.
   * Safe to call before the chat is ready: the screen appears and fills in.
   */
  show(): void {
    if (!state.entryInUse) throw new Error('CentralChat.init() must be called before show()');
    state.shown = true;
    render();
  },

  /**
   * Puts it away, keeping the session, the thread and the scroll position. The
   * WebView is hidden, never unmounted — which is what makes the next show()
   * instant.
   */
  hide(): void {
    state.shown = false;
    render();
  },
};

function restartTimeout(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(
    () => settleError({code: 'INTERNAL', message: 'the chat never became ready'}),
    READY_TIMEOUT_MS,
  );
}

function settleReady(): void {
  if (timer) clearTimeout(timer);
  if (state.resolved) return;
  state.resolved = true;
  CentralChat.onReady?.();
}

let reload: (() => void) | undefined;

/**
 * One automatic reload, for transport failures only.
 *
 * The page's HTML and its scripts come from two origins, each with its own DNS
 * and TLS; a stalled second fetch leaves a document that looks healthy and never
 * boots. A reload usually just works. A rejected entry is never retried — the
 * same one is rejected identically, and minting another is the host's call, not
 * ours.
 */
/**
 * Turn away an entry this library can see is malformed, loading nothing. The
 * next init() with a usable entry starts clean.
 */
function refuse(message: string): void {
  if (timer) clearTimeout(timer);
  state.entryInUse = undefined;
  state.resolved = true;
  CentralChat.onError?.({code: 'ENTRY_INVALID', message});
}

function settleError(error: CentralChatError): void {
  if (timer) clearTimeout(timer);
  if (state.resolved) return;
  if (!state.retried && error.code === 'NETWORK' && reload) {
    state.retried = true;
    reload();
    restartTimeout();
    return;
  }
  state.resolved = true;
  CentralChat.onError?.(error);
}

/**
 * Mount this ONCE, above your navigator. It is the chat: hidden until show(),
 * and never unmounted, so the session, the keys and the thread stay warm.
 *
 * Rendered at zero opacity rather than removed, on purpose: an unmounted tree
 * is never laid out, so the first show() would pay for layout, fonts, images
 * and the thread's first frame all at once — which is the jank this exists to
 * avoid.
 */
export function CentralChatHost() {
  const web = useRef<WebView>(null);
  const [, bump] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    state.notify = () => bump((n) => n + 1);
    reload = () => {
      loaded.current = false;
      web.current?.reload();
    };
    return () => {
      state.notify = undefined;
      reload = undefined;
    };
  }, []);

  // show() and hide() can be called at any time after the page has loaded, and
  // the opacity this component toggles is only half of it: the container keeps
  // its OWN visibility, and a page still holding the hide() it was sent at load
  // renders nothing however opaque the view above it is. No dependency array —
  // a render is exactly when state.shown can have changed. Before the early
  // return below, because hooks cannot run conditionally.
  useEffect(() => {
    if (!loaded.current) return;    // onLoadEnd sends the first one
    web.current?.injectJavaScript(
      `${state.shown ? 'CentralChat.show()' : 'CentralChat.hide()'}; true;`,
    );
  });

  // Nothing to mount until the host has called init(): the entry is what names
  // the line, and there is no chat without one.
  if (!state.entryInUse) return null;

  // The page's own inline script defines CentralChat, so the document has to
  // have been parsed before anything is sent to it. JSON.stringify does the
  // quoting; nothing is spliced into JavaScript.
  const send = (js: string) => web.current?.injectJavaScript(`${js}; true;`);

  return (
    <View
      style={[StyleSheet.absoluteFill, state.shown ? styles.shown : styles.warm]}
      pointerEvents={state.shown ? 'auto' : 'none'}
      accessibilityElementsHidden={!state.shown}
      importantForAccessibility={state.shown ? 'auto' : 'no-hide-descendants'}>
      <WebView
        ref={web}
        source={{uri: CentralChat.containerUrl}}
        // Voice notes, the camera and the file picker.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        geolocationEnabled
        allowFileAccess
        javaScriptEnabled
        // The session survives restarts: this is the store the chat keeps its
        // keys and its thread in.
        domStorageEnabled
        // Pinned to one origin: anything else is a link inside a message, and
        // belongs in the browser, not in a WebView holding a live session.
        // Pinned to one origin: anything else is a link inside a message, and
        // belongs in the browser, not in a WebView holding a live session.
        // Refusing alone would only make it a dead tap, so it is handed over.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith(originOf(CentralChat.containerUrl))) return true;
          openExternally(request.url);
          return false;
        }}
        onLoadEnd={() => {
          loaded.current = true;
          // The capability goes FIRST and in the same pass as init: the page
          // reads it when it mounts, so an injection after that is too late.
          //
          // Guarded, and not optionally so: the page ships on the CDN
          // independently of this app, so a library is ALWAYS newer than some
          // container out there. Calling a method an older page does not define
          // throws, and `injectJavaScript` swallows it — leaving a blank screen
          // and a 20-second INTERNAL, from a feature meant to be optional.
          if (secureStore) send('if(CentralChat.useNativeStorage)CentralChat.useNativeStorage()');
          if (state.entryInUse) send(`CentralChat.init(${JSON.stringify(state.entryInUse)})`);
          send(state.shown ? 'CentralChat.show()' : 'CentralChat.hide()');
        }}
        // A font or an image failing is not the page failing; only the document is.
        onError={({nativeEvent}) => {
          if (nativeEvent.url?.startsWith(CentralChat.containerUrl)) {
            settleError({code: 'NETWORK', message: 'could not load the chat'});
          }
        }}
        // Returning true says this was handled — without it a renderer killed
        // under memory pressure takes the whole host app down with it.
        onRenderProcessGone={() => {
          loaded.current = false;
          settleError({code: 'NETWORK', message: 'the chat renderer stopped'});
          return true;
        }}
        onMessage={(event) => {
          const parsed = safeParse(event.nativeEvent.data);
          // Not an event: a REQUEST, and the only frame this bridge answers
          // rather than observes.
          if (parsed?.type === 'storage') {
            void answerStorage(parsed, send);
            return;
          }
          if (parsed?.type === 'ready') settleReady();
          // The page never navigates itself away from the bundle: it turns a
          // tapped link into this event and waits for the host to act. Nothing
          // here means a dead link.
          if (parsed?.type === 'linkActivated') openExternally(parsed.payload?.url);
          if (parsed?.type === 'error') {
            settleError({
              code: (parsed.payload?.code as CentralChatErrorCode) ?? 'INTERNAL',
              message: parsed.payload?.message ?? '',
            });
          }
        }}
        style={styles.web}
      />
      {state.shown ? (
        // The page fills the screen and has no chrome of its own, so the way
        // out is the host's to provide. Top end, where the chat's header is
        // empty.
        <Pressable
          onPress={() => CentralChat.hide()}
          accessibilityRole="button"
          accessibilityLabel="Close the chat"
          style={styles.close}>
          <Text style={styles.closeText}>{'✕'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Hand-rolled rather than `new URL()`: React Native's URL is a partial polyfill
// whose `origin` is empty on some versions, and an empty prefix would let the
// WebView follow a link out of the bundle.
function originOf(url: string): string {
  const match = /^(https?:\/\/[^/]+)\//.exec(url);
  if (!match?.[1]) throw new Error(`CentralChat.containerUrl must be an absolute https url: ${url}`);
  return `${match[1]}/`;
}

/**
 * Hand a URL to the browser. Swallowed on failure because a device can be
 * without one — a kiosk, a stripped image — and a rejected promise out of a
 * WebView callback is an unhandled rejection over a tapped link.
 */
function openExternally(url: string | undefined): void {
  if (!url) return;
  void Linking.openURL(url).catch(() => undefined);
}

function safeParse(
  raw: string,
): {type?: string; rid?: string; payload?: Record<string, string>} | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const styles = StyleSheet.create({
  warm: {opacity: 0},
  shown: {opacity: 1},
  web: {flex: 1, backgroundColor: 'transparent'},
  close: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 0,
    right: 0,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Explicit: the chat's header is light whatever the host app's theme is, and
  // an inherited dark-mode colour disappears into it.
  closeText: {fontSize: 20, color: '#3C4043'},
});
