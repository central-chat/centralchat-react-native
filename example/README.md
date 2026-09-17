# Central Chat example — React Native

```bash
npm install
npm start          # then press a for Android, i for iOS
```

Runs in **Expo Go** — no pods. The camera is the exception: it needs the
`<queries>` this app's [config plugin](plugins/withCameraQueries.js) adds, so to
test that one, build it properly:

```bash
npx expo run:android
```

Paste a **channel key** (`businessId|chatAccountId`) or a **mint user key**, tap
**Test**, then **Open central.chat**.

## What to read

[`App.tsx`](App.tsx), and in it two calls plus one component —
`CentralChat.init(entry)`, `CentralChat.show()`, and `<CentralChatHost/>`
mounted once at the root. Mount the host **above** your navigator, never inside
a screen: a remount throws away the warm WebView.

Your app has no key field: it asks its backend for a mint user key on every
start and calls `init` with it.

It installs `@centralchat/react-native-widget` from npm, exactly as you would —
this example is the thing people copy, so it must not take a shortcut none of
them can take. To work against the library source instead, `npm pack` it and
install the tarball; a `file:` path does not work, because Metro resolves
`react` from the linked directory's own tree rather than this app's.
