// Android 11+ package visibility: an app sees only the apps it declares an
// interest in. `react-native-webview` calls resolveActivity() before launching
// the camera, and it declares queries for Chromium's payment intents only — so
// without this the composer's camera button resolves nothing and does nothing
// at all, with no error the person can see. Expo Go happens to declare these,
// which is why the camera can work there and not in your own build.
const {withAndroidManifest} = require('expo/config-plugins');

const CAPTURE = ['android.media.action.IMAGE_CAPTURE', 'android.media.action.VIDEO_CAPTURE'];

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    const {manifest} = mod.modResults;
    manifest.queries = manifest.queries ?? [];
    for (const action of CAPTURE) {
      const declared = manifest.queries.some((q) =>
        (q.intent ?? []).some((i) =>
          (i.action ?? []).some((a) => a.$?.['android:name'] === action),
        ),
      );
      if (!declared) {
        manifest.queries.push({intent: [{action: [{$: {'android:name': action}}]}]});
      }
    }
    return mod;
  });
