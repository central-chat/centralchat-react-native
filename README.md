# Central Chat — React Native

```bash
npm install @centralchat/react-native-widget react-native-webview
```

```tsx
// App.tsx — mount the host ONCE, above your navigator, never inside a screen.
<><YourNavigator /><CentralChatHost /></>

CentralChat.init(entry)   // at start — warms everything
CentralChat.show()        // from your support button
CentralChat.hide()        // optional; the screen closes itself
```

`entry` is a **channel key** (`businessId|chatAccountId`, anonymous) or a **mint
user key** your backend signed (that person). One argument, either door.

No native module — no pods, no autolinking, and it runs in **Expo Go**
(except the camera; see below). RN 0.72+ ·
iOS 15 · `minSdk` 24.

### Optional

```ts
CentralChat.onReady = () => {};                 // warm; enable your button here
CentralChat.onError = ({code, message}) => {};  // ENTRY_INVALID | TOKEN_EXPIRED | NETWORK | INTERNAL
CentralChat.useSecureStore({get, set, remove, list});  // before init — keeps the session out of WebView storage
```

Permissions, only for what your chat account offers: `RECORD_AUDIO` +
`MODIFY_AUDIO_SETTINGS` and `ACCESS_*_LOCATION` on Android, the four
`NS*UsageDescription` keys on iOS.

**The camera needs one line of manifest, or it silently does nothing.**
Android 11+ shows an app only the apps it declares an interest in, and
`react-native-webview` resolves the camera before launching it — so without
this it finds nothing, gives up, and the button does not even flicker:

```xml
<queries>
  <intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent>
  <intent><action android:name="android.media.action.VIDEO_CAPTURE"/></intent>
</queries>
```

On Expo that is a config plugin — copy
[`withCameraQueries.js`](../../example/react-native/plugins/withCameraQueries.js).
**Do not declare `CAMERA`**: the capture intent needs no permission, and
declaring it makes both Android and `react-native-webview` start demanding one.
Expo Go declares it, which is why the camera behaves differently there than in
your own build — test this in a dev build, never in Expo Go.

Don't wrap the host in `KeyboardAvoidingView` — the page insets its own
composer. Example: [`../../example/react-native`](../../example/react-native).
