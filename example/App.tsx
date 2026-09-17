// The Central Chat example — one screen, and the only file worth reading.
//
// It asks for a key and opens the chat. The whole integration is three calls
// and one component; everything else here is the box around them:
//
//   CentralChat.init(entry)
//   CentralChat.show()
//   CentralChat.hide()
//
// YOUR app has no key field. It asks its own backend for a mint user key on
// every start — the key names the person and expires in minutes — and calls
// init() with it.
import {useEffect, useState} from 'react';
import {Button, StyleSheet, Text, TextInput, View} from 'react-native';
// react-native's own SafeAreaView is deprecated as of RN 0.80; this is the
// replacement it points at, and the provider has to wrap the whole app.
import {SafeAreaProvider, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {CentralChat, CentralChatHost} from '@centralchat/react-native-widget';

export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const [entry, setEntry] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    CentralChat.onReady = () => {
      setReady(true);
      setStatus('');
    };
    CentralChat.onError = ({code, message}) => {
      // The library retries a transport failure by itself, so this only
      // reports. A refused key is the one an app has to answer, by minting
      // another — this demo has no backend, so it asks for another by hand.
      setReady(false);
      setStatus(`${code}: ${message}`);
    };
  }, []);

  const insets = useSafeAreaInsets();

  return (
    <>
      <SafeAreaView style={styles.screen}>
        <View style={styles.page}>
          <Text style={styles.title}>Central.chat test demo app</Text>
          {signedIn ? (
            <>
              <Text style={styles.heading}>Your app will be here</Text>
              <Button title="Open central.chat" disabled={!ready} onPress={() => CentralChat.show()} />
            </>
          ) : (
            <>
              <Text style={styles.label}>Channel key or mint user key</Text>
              <TextInput
                style={styles.field}
                value={entry}
                onChangeText={setEntry}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                title="Test"
                onPress={() => {
                  if (!entry.trim()) return;
                  CentralChat.init(entry.trim());   // step 1 — warms everything
                  setSignedIn(true);
                }}
              />
            </>
          )}
          <Text style={styles.status}>{status}</Text>
        </View>
      </SafeAreaView>
      {/* Mounted ONCE, above everything, and never unmounted — that is what
          keeps the chat warm. It draws nothing until show().

          The host fills whatever box it is given, and the chat's header and
          composer sit hard against its edges — so the safe area is the app's to
          give it. Offsets rather than padding: the host positions itself
          absolutely, and an absolute child is laid out against its parent's
          BORDER box, so padding here would change nothing. `box-none` because
          this wrapper covers the screen even while the chat is hidden, and must
          never swallow a tap meant for the app. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: insets.left,
          right: insets.right,
          top: insets.top,
          bottom: insets.bottom,
        }}>
        <CentralChatHost />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  page: {padding: 24, gap: 12},
  title: {fontSize: 26, fontWeight: 'bold'},
  heading: {fontSize: 24, fontWeight: 'bold', textAlign: 'center'},
  label: {fontSize: 13, fontWeight: 'bold'},
  field: {borderBottomWidth: 1, borderColor: '#999', paddingVertical: 8},
  status: {fontSize: 14, color: '#b00'},
});
