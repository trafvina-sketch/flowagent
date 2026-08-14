/**
 * StreamFlow i18n (Internationalization) Utility
 * 
 * Loads JSON language files from locales/ directory.
 * Supports nested keys (e.g., 'nav.streams'), interpolation (e.g., '{current}/{total}'),
 * and fallback chain: current language → English → raw key.
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');
const localesCache = {};
const supportedLanguages = ['en', 'vi'];
const defaultLanguage = 'vi';

/**
 * Load a language file and cache it
 * @param {string} lang - Language code (e.g., 'en', 'vi')
 * @returns {object} The parsed language object
 */
function loadLocale(lang) {
  if (localesCache[lang]) {
    return localesCache[lang];
  }

  const filePath = path.join(localesDir, `${lang}.json`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    localesCache[lang] = JSON.parse(content);
  } catch (error) {
    console.error(`[i18n] Failed to load locale "${lang}":`, error.message);
    localesCache[lang] = {};
  }

  return localesCache[lang];
}

/**
 * Get a nested value from an object using a dot-separated key
 * @param {object} obj - The object to search
 * @param {string} key - Dot-separated key (e.g., 'nav.streams')
 * @returns {string|undefined} The value if found
 */
function getNestedValue(obj, key) {
  if (!obj || !key) return undefined;

  const keys = key.split('.');
  let current = obj;

  for (const k of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[k];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate parameters into a string
 * Replaces {paramName} with the corresponding value from params
 * @param {string} str - The template string
 * @param {object} params - Key-value pairs for interpolation
 * @returns {string} The interpolated string
 */
function interpolate(str, params) {
  if (!params || typeof params !== 'object') return str;

  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return params.hasOwnProperty(key) ? params[key] : match;
  });
}

/**
 * Create a translator function for a specific language
 * @param {string} lang - Language code (e.g., 'en', 'vi')
 * @returns {function} Translator function t(key, params)
 */
function getTranslator(lang) {
  // Validate language, fallback to default
  if (!supportedLanguages.includes(lang)) {
    lang = defaultLanguage;
  }

  const currentLocale = loadLocale(lang);
  const fallbackLocale = lang !== 'en' ? loadLocale('en') : null;

  /**
   * Translate a key with optional interpolation
   * @param {string} key - Dot-separated translation key (e.g., 'common.save')
   * @param {object} [params] - Optional parameters for interpolation
   * @returns {string} Translated string
   */
  function t(key, params) {
    // Try current language first
    let value = getNestedValue(currentLocale, key);

    // Fallback to English
    if (value === undefined && fallbackLocale) {
      value = getNestedValue(fallbackLocale, key);
    }

    // If still not found, return the key itself
    if (value === undefined) {
      return key;
    }

    // Interpolate parameters
    return interpolate(value, params);
  }

  return t;
}

/**
 * Clear the locale cache (useful for development/hot-reload)
 */
function clearCache() {
  Object.keys(localesCache).forEach(key => delete localesCache[key]);
}

/**
 * Get list of supported languages
 * @returns {string[]} Array of language codes
 */
function getSupportedLanguages() {
  return [...supportedLanguages];
}

module.exports = {
  getTranslator,
  clearCache,
  getSupportedLanguages,
  supportedLanguages,
  defaultLanguage
};
