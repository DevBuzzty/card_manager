module.exports = {
  SOCKET_PORT: 4000,
  ALLOWED_ORIGINS: [
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  WINDOW_CONFIG: {
    width: 1400,
    height: 900,
    backgroundColor: '#121212'
  },
  ALLOWED_SETTING_KEYS: [
    'gemini_api_key',
    'price_source',
    'scanner_auth_token'
  ]
};
