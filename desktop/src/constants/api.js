export const CARD_IMAGE_BASE_URL = 'https://images.ygoprodeck.com/images/cards/';
export const getCardImageUrl = (id) => `${CARD_IMAGE_BASE_URL}${id}.jpg`;

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1';
export const GEMINI_MODEL_ENDPOINT = 'models/gemini-pro:generateContent';
