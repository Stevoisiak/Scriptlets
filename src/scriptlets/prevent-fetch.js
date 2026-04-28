import {
    hit,
    getFetchData,
    objectToString,
    matchRequestProps,
    logMessage,
    createResponse,
    copyResponseHeaders,
    defineReadonlyResponseProps,
    getFilteredResponseDefaults,
    getSafeResponseStatus,
    isSuccessResponseStatus,
    modifyResponse,
    toRegExp,
    isValidStrPattern,
    escapeRegExp,
    isEmptyObject,
    getRequestData,
    getRequestProps,
    parseMatchProps,
    isValidParsedData,
    getMatchPropsData,
    generateRandomResponse,
    nativeIsFinite,
    nativeIsNaN,
    getNumberFromString,
    getRandomIntInclusive,
    getRandomStrByLength,
} from '../helpers';

/* eslint-disable max-len */
/**
 * @scriptlet prevent-fetch
 *
 * @description
 * Prevents `fetch` calls if **all** given parameters match.
 *
 * Related UBO scriptlet:
 * https://github.com/gorhill/uBlock/wiki/Resources-Library#no-fetch-ifjs-
 *
 * ### Syntax
 *
 * ```text
 * example.org#%#//scriptlet('prevent-fetch'[, propsToMatch[, responseBody[, responseConfig]]])
 * ```
 *
 * - `propsToMatch` — optional, string of space-separated properties to match; possible props:
 *     - string or regular expression for matching the URL passed to fetch call;
 *       empty string, wildcard `*` or invalid regular expression will match all fetch calls
 *     - colon-separated pairs `name:value` where
 *         <!-- markdownlint-disable-next-line line-length -->
 *         - `name` is [`init` option name](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#parameters)
 *         - `value` is string or regular expression for matching the value of the option passed to fetch call;
 *           invalid regular expression will cause any value matching
 * - `responseBody` — optional, string for defining response body value,
 *   defaults to `emptyObj`. Possible values:
 *     - `emptyObj` — empty object
 *     - `emptyArr` — empty array
 *     - `emptyStr` — empty string
 *     - `true` — random alphanumeric string of 10 symbols
 *     - colon-separated pair `name:value` string value to customize `responseBody` where
 *         - `name` — only `length` supported for now
 *         - `value` — range on numbers, for example `100-300`, limited to 500000 characters
 * - `responseConfig` — optional, string for defining response properties.
 *   Original response values are used if not specified. Possible values:
 *     - response type shorthand (for backwards compatibility):
 *         - `basic`
 *         - `cors`
 *         - `error`
 *         - `opaque`
 *         - `opaqueredirect`
 *     - JSON object string with quoted keys and any combination of these properties:
 *         - `ok` — boolean
 *         - `redirected` — boolean
 *         - `status` — non-negative integer from range `0..599`
 *         - `statusText` — one of `""`, `"OK"`, `"Continue"`, `"Not Found"`
 *         - `type` — one of the supported response type values above
 *
 * > Usage with no arguments will log fetch calls to browser console;
 * > it may be useful for debugging but it is not allowed for prod versions of filter lists.
 *
 * ### Examples
 *
 * 1. Log all fetch calls
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch')
 *     ```
 *
 * 1. Prevent all fetch calls
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch', '*')
 *     ! or
 *     example.org#%#//scriptlet('prevent-fetch', '')
 *     ```
 *
 * 1. Prevent fetch call for specific url
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch', '/url\\.part/')
 *     ```
 *
 * 1. Prevent fetch call for specific request method
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch', 'method:HEAD')
 *     ```
 *
 * 1. Prevent fetch call for specific url and request method
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch', '/specified_url_part/ method:/HEAD|GET/')
 *     ```
 *
 * 1. Prevent fetch call and specify response body value
 *
 *     ```adblock
 *     ! Specify response body for fetch call to a specific url
 *     example.org#%#//scriptlet('prevent-fetch', '/specified_url_part/ method:/HEAD|GET/', 'emptyArr')
 *
 *     ! Specify response body for all fetch calls
 *     example.org#%#//scriptlet('prevent-fetch', '', 'emptyArr')
 *
 *     ! Specify response body to random alphanumeric string of 10 symbols for all fetch calls
 *     example.org#%#//scriptlet('prevent-fetch', '', 'true')
 *
 *     ! Specify response body to random alphanumeric string with specific range for all fetch calls
 *     example.org#%#//scriptlet('prevent-fetch', '', 'length:100-300')
 *     ```
 *
 * 1. Prevent all fetch calls and specify response type value
 *
 *     ```adblock
 *     example.org#%#//scriptlet('prevent-fetch', '*', '', 'opaque')
 *     ```
 *
 * 1. Prevent all fetch calls and specify response properties
 *
 *     ```adblock
 *     ! Set multiple response properties at once
 *     example.org#%#//scriptlet('prevent-fetch', '*', '', '{"status": 404, "statusText": "Not Found", "ok": false}')
 *
 *     ! Set response type together with other values
 *     example.org#%#//scriptlet('prevent-fetch', '*', '', '{"type": "opaqueredirect", "redirected": true}')
 *     ```
 *
 * @added v1.3.18.
 */
/* eslint-enable max-len */
// eslint-disable-next-line default-param-last
export function preventFetch(source, propsToMatch, responseBody = 'emptyObj', responseConfig) {
    // do nothing if browser does not support fetch or Proxy (e.g. Internet Explorer)
    // https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
    if (typeof fetch === 'undefined'
        || typeof Proxy === 'undefined'
        || typeof Response === 'undefined') {
        return;
    }

    const SUPPORTED_RESPONSE_TYPES = new Set([
        'basic',
        'cors',
        'error',
        'opaque',
        'opaqueredirect',
    ]);
    const SUPPORTED_STATUS_TEXTS = new Set([
        '',
        'OK',
        'Continue',
        'Not Found',
    ]);
    const INVALID_RESPONSE_VALUE_MARKER = null;
    const isResponseTypeSupported = (value) => SUPPORTED_RESPONSE_TYPES.has(value);
    const isResponseStatusTextSupported = (value) => SUPPORTED_STATUS_TEXTS.has(value);
    const isValidResponseStatus = (value) => {
        const isInteger = nativeIsFinite(value) && Math.floor(value) === value;
        // `0` is used for filtered responses, may be useful when
        // response type is set to `error`, `opaque` or `opaqueredirect`.
        // While regular HTTP statuses stay within `100..599`.
        // Values above `599` are outside the standard HTTP status code space.
        return isInteger && value >= 0 && value <= 599;
    };
    const getInvalidResponseConfigMessage = (value) => `Invalid responseConfig parameter: '${value}'`;

    /**
     * Parse the response config argument into a normalized override object.
     *
     * @param {string|undefined} value - Raw responseConfig argument.
     * @returns {*} Parsed response config.
     */
    const parseResponseConfig = (value) => {
        if (typeof value === 'undefined') {
            return undefined;
        }

        if (isResponseTypeSupported(value)) {
            return {
                type: value,
            };
        }

        if (typeof value !== 'string') {
            logMessage(source, getInvalidResponseConfigMessage(value));
            return INVALID_RESPONSE_VALUE_MARKER;
        }

        const trimmedResponseConfig = value.trim();
        if (!trimmedResponseConfig.startsWith('{') || !trimmedResponseConfig.endsWith('}')) {
            logMessage(source, getInvalidResponseConfigMessage(value));
            return INVALID_RESPONSE_VALUE_MARKER;
        }

        let parsedResponseConfig;
        try {
            parsedResponseConfig = JSON.parse(trimmedResponseConfig);
        } catch (error) {
            logMessage(source, getInvalidResponseConfigMessage(value));
            return INVALID_RESPONSE_VALUE_MARKER;
        }

        if (
            !parsedResponseConfig
            || Array.isArray(parsedResponseConfig)
            || typeof parsedResponseConfig !== 'object'
        ) {
            logMessage(source, getInvalidResponseConfigMessage(value));
            return INVALID_RESPONSE_VALUE_MARKER;
        }

        const normalizedResponseConfig = {};
        const responseConfigKeys = Object.keys(parsedResponseConfig);

        for (let i = 0; i < responseConfigKeys.length; i += 1) {
            const key = responseConfigKeys[i];
            const parsedValue = parsedResponseConfig[key];

            if ((key === 'ok' || key === 'redirected') && typeof parsedValue === 'boolean') {
                normalizedResponseConfig[key] = parsedValue;
                continue;
            }

            if (key === 'status' && isValidResponseStatus(parsedValue)) {
                normalizedResponseConfig[key] = parsedValue;
                continue;
            }

            if (
                key === 'statusText'
                && typeof parsedValue === 'string'
                && isResponseStatusTextSupported(parsedValue)
            ) {
                normalizedResponseConfig[key] = parsedValue;
                continue;
            }

            if (
                key === 'type'
                && typeof parsedValue === 'string'
                && isResponseTypeSupported(parsedValue)
            ) {
                normalizedResponseConfig[key] = parsedValue;
                continue;
            }

            logMessage(source, getInvalidResponseConfigMessage(value));
            return INVALID_RESPONSE_VALUE_MARKER;
        }

        return normalizedResponseConfig;
    };

    /**
     * Merge parsed response config with a detected fallback response type.
     *
     * @param {*} parsedConfig - Parsed response config.
     * @param {string|undefined} fallbackType - Response type inferred from the request.
     * @returns {*} Resolved response config.
     */
    const getResolvedResponseConfig = (parsedConfig, fallbackType) => {
        const resolvedResponseConfig = {};

        if (typeof fallbackType !== 'undefined') {
            resolvedResponseConfig.type = fallbackType;
        }

        if (typeof parsedConfig === 'undefined') {
            return resolvedResponseConfig;
        }

        return Object.assign(resolvedResponseConfig, parsedConfig);
    };

    const nativeRequestClone = Request.prototype.clone;

    let strResponseBody;
    if (responseBody === '' || responseBody === 'emptyObj') {
        strResponseBody = '{}';
    } else if (responseBody === 'emptyArr') {
        strResponseBody = '[]';
    } else if (responseBody === 'emptyStr') {
        strResponseBody = '';
    } else if (responseBody === 'true' || responseBody.match(/^length:\d+-\d+$/)) {
        strResponseBody = generateRandomResponse(responseBody);
    } else {
        logMessage(source, `Invalid responseBody parameter: '${responseBody}'`);
        return;
    }

    const parsedResponseConfig = parseResponseConfig(responseConfig);
    if (parsedResponseConfig === INVALID_RESPONSE_VALUE_MARKER) {
        return;
    }

    const EXTENSION_SCHEMES = [
        'chrome-extension:',
        'moz-extension:',
        'ms-browser-extension:',
        'safari-web-extension:',
    ];

    /**
     * Check whether a URL uses a known browser extension scheme.
     * https://github.com/AdguardTeam/Scriptlets/issues/545
     *
     * @param {string} url - URL string to check.
     * @returns {boolean} `true` if the URL starts with a known extension scheme.
     */
    const isExtensionScheme = (url) => EXTENSION_SCHEMES.some((scheme) => url.startsWith(scheme));

    /**
     * Get the response type based on the given request object.
     *
     * @param {Request} request - The request object.
     * @returns {string|undefined} The response type or undefined.
     */
    const getResponseType = (request) => {
        try {
            const { mode } = request;
            if (mode === undefined || mode === 'cors' || mode === 'no-cors') {
                const fetchURL = new URL(request.url);
                if (fetchURL.origin === document.location.origin) {
                    return 'basic';
                }
                return mode === 'no-cors' ? 'opaque' : 'cors';
            }
        } catch (error) {
            logMessage(source, `Could not determine response type: ${error}`);
        }
        return undefined;
    };

    const handlerWrapper = async (target, thisArg, args) => {
        let shouldPrevent = false;
        const fetchData = getFetchData(args, nativeRequestClone);
        if (typeof propsToMatch === 'undefined') {
            logMessage(source, `fetch( ${objectToString(fetchData)} )`, true);
            hit(source);
            return Reflect.apply(target, thisArg, args);
        }

        shouldPrevent = matchRequestProps(source, propsToMatch, fetchData);

        if (shouldPrevent) {
            hit(source);
            let resolvedResponseConfig;
            try {
                resolvedResponseConfig = getResolvedResponseConfig(parsedResponseConfig, getResponseType(fetchData));
                const origResponse = await Reflect.apply(target, thisArg, args);
                // In the case of apps, the blocked request has status 500
                // and no error is thrown, so it's necessary to check response.ok
                // https://github.com/AdguardTeam/Scriptlets/issues/334
                if (!origResponse.ok || isExtensionScheme(origResponse.url)) {
                    return createResponse({
                        body: strResponseBody,
                        ok: resolvedResponseConfig.ok,
                        redirected: resolvedResponseConfig.redirected,
                        requestUrl: fetchData.url,
                        status: resolvedResponseConfig.status,
                        statusText: resolvedResponseConfig.statusText,
                        type: resolvedResponseConfig.type,
                    });
                }
                return modifyResponse(
                    origResponse,
                    {
                        body: strResponseBody,
                        ok: resolvedResponseConfig.ok,
                        redirected: resolvedResponseConfig.redirected,
                        status: resolvedResponseConfig.status,
                        statusText: resolvedResponseConfig.statusText,
                        type: resolvedResponseConfig.type,
                    },
                );
            } catch (ex) {
                // https://github.com/AdguardTeam/Scriptlets/issues/334
                resolvedResponseConfig = getResolvedResponseConfig(parsedResponseConfig, getResponseType(fetchData));
                return createResponse({
                    body: strResponseBody,
                    ok: resolvedResponseConfig.ok,
                    redirected: resolvedResponseConfig.redirected,
                    requestUrl: fetchData.url,
                    status: resolvedResponseConfig.status,
                    statusText: resolvedResponseConfig.statusText,
                    type: resolvedResponseConfig.type,
                });
            }
        }

        return Reflect.apply(target, thisArg, args);
    };

    const fetchHandler = {
        apply: handlerWrapper,
    };

    fetch = new Proxy(fetch, fetchHandler); // eslint-disable-line no-global-assign
}

export const preventFetchNames = [
    'prevent-fetch',
    // aliases are needed for matching the related scriptlet converted into our syntax
    'prevent-fetch.js',
    'ubo-prevent-fetch.js',
    'ubo-prevent-fetch',
    'no-fetch-if.js',
    'ubo-no-fetch-if.js',
    'ubo-no-fetch-if',
];

// eslint-disable-next-line prefer-destructuring
preventFetch.primaryName = preventFetchNames[0];

preventFetch.injections = [
    hit,
    getFetchData,
    objectToString,
    matchRequestProps,
    logMessage,
    createResponse,
    copyResponseHeaders,
    defineReadonlyResponseProps,
    getFilteredResponseDefaults,
    getSafeResponseStatus,
    isSuccessResponseStatus,
    modifyResponse,
    toRegExp,
    isValidStrPattern,
    escapeRegExp,
    isEmptyObject,
    getRequestData,
    getRequestProps,
    parseMatchProps,
    isValidParsedData,
    getMatchPropsData,
    generateRandomResponse,
    nativeIsFinite,
    nativeIsNaN,
    getNumberFromString,
    getRandomIntInclusive,
    getRandomStrByLength,
];
