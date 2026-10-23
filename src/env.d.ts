interface ImportMetaEnv {
  /**
   * MQTT-over-WebSocket broker URL baked into the build for the remote-control
   * feature; see the README's "Remote control" section. Falls back to the
   * public instance's broker when unset.
   */
  readonly VITE_MQTT_URL?: string;
}

declare module 'virtual:docs' {
  const html: string;
  export default html;
}
