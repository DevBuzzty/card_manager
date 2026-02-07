module.exports = {
    PORT: 4000,
    DEFAULT_IP: '127.0.0.1',
    WINDOW_WIDTH: 1400,
    WINDOW_HEIGHT: 900,
    BACKGROUND_COLOR: '#121212',
    ALLOWED_SETTING_KEYS: [
        'price_source',
        'gemini_api_key'
    ],
    DEFAULT_PRICE_SOURCE: 'cardmarket',
    PRICE_SOURCE_MAP: {
        'cardmarket': 'cardmarket_price',
        'tcgplayer': 'tcgplayer_price',
        'ebay': 'ebay_price',
        'amazon': 'amazon_price',
        'coolstuffinc': 'coolstuffinc_price'
    }
};
