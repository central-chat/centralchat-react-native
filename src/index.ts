/**
 * `@centralchat/react-native-widget` — the Central chat in a React Native app.
 *
 * Three calls and one component. No native modules, no pods, no autolinking:
 * the chat is the same page the web embed and the two native libraries load, so
 * a chat upgrade needs no app release and the four platforms cannot drift.
 *
 * ```tsx
 * // App.tsx — mount the host ONCE, above your navigator.
 * import {CentralChat, CentralChatHost} from '@centralchat/react-native-widget';
 *
 * useEffect(() => {
 *   CentralChat.init(await mintToken());   // or: 'businessId|chatAccountId'
 * }, []);
 *
 * return (
 *   <>
 *     <YourNavigator />
 *     <CentralChatHost />
 *   </>
 * );
 *
 * // the support button, anywhere
 * <Button title="Support" onPress={() => CentralChat.show()} />
 * ```
 */
export {CentralChat, CentralChatHost} from './CentralChat';
export type {
  CentralChatError,
  CentralChatErrorCode,
  CentralChatSecureStore,
} from './CentralChat';
