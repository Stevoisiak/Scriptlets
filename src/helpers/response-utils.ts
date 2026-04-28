type ReplacementData = {
    body?: string | null;
    type?: string;
    ok?: boolean;
    redirected?: boolean;
    status?: number;
    statusText?: string;
};

type SyntheticResponseData = ReplacementData & {
    headers?: HeadersInit;
    requestUrl?: string;
};

/**
 * Copies response headers into a plain object accepted by the Response constructor.
 *
 * @param sourceHeaders Headers to copy.
 * @returns Plain headers object.
 */
export const copyResponseHeaders = (sourceHeaders?: Headers): HeadersInit => {
    const headers: HeadersInit = {};

    sourceHeaders?.forEach((value, key) => {
        headers[key] = value;
    });

    return headers;
};

/**
 * Checks whether a response status code is successful.
 *
 * @param status Response status code.
 * @returns `true` if the status code is in the `200..299` range.
 */
export const isSuccessResponseStatus = (status: number): boolean => status >= 200 && status <= 299;

/**
 * Returns a normalized response status code used for the final response shape.
 *
 * @param status Response status code.
 * @returns Status code in the `0..599` range or `200` for invalid values.
 */
export const getSafeResponseStatus = (status: number | undefined): number => {
    if (typeof status === 'number' && status >= 0 && status <= 599) {
        return status;
    }

    return 200;
};

/**
 * Defines readonly response properties on a response object.
 *
 * @param response Response to patch.
 * @param props Property overrides to define.
 */
export const defineReadonlyResponseProps = (
    response: Response,
    props: ReplacementData & { url?: string },
): void => {
    const descriptors: PropertyDescriptorMap = {};

    if (typeof props.body !== 'undefined' && props.body === null && response.body !== null) {
        descriptors.body = { value: null };
    }
    if (typeof props.status !== 'undefined' && response.status !== props.status) {
        descriptors.status = { value: props.status };
    }
    if (typeof props.statusText !== 'undefined' && response.statusText !== props.statusText) {
        descriptors.statusText = { value: props.statusText };
    }
    if (typeof props.url !== 'undefined' && response.url !== props.url) {
        descriptors.url = { value: props.url };
    }
    if (typeof props.type !== 'undefined' && response.type !== props.type) {
        descriptors.type = { value: props.type };
    }
    if (typeof props.ok !== 'undefined' && response.ok !== props.ok) {
        descriptors.ok = { value: props.ok };
    }
    if (typeof props.redirected !== 'undefined' && response.redirected !== props.redirected) {
        descriptors.redirected = { value: props.redirected };
    }

    if (Object.keys(descriptors).length > 0) {
        Object.defineProperties(response, descriptors);
    }
};

/**
 * Returns default response properties for filtered response types.
 *
 * These defaults emulate what fetch exposes for filtered responses:
 * no readable body, `ok === false`, `status === 0`, empty `statusText`, and an empty URL.
 *
 * @param type Response type.
 * @returns Filtered response defaults for `opaque`, `error`, and
 * `opaqueredirect`, or an empty object for other response types.
 */
export const getFilteredResponseDefaults = (type?: string): ReplacementData & { url?: string } => {
    if (type !== 'opaque' && type !== 'error' && type !== 'opaqueredirect') {
        return {};
    }

    return {
        body: null,
        ok: false,
        status: 0,
        statusText: '',
        url: '',
    };
};

/**
 * Modifies original response with the given replacement data.
 *
 * @param origResponse Original response.
 * @param replacement Replacement data for response with possible keys:
 * - `body`: optional, string, default to '{}';
 * - `type`: optional, string, original response type is used if not specified.
 *
 * @returns Modified response.
 */
export const modifyResponse = (
    origResponse: Response,
    replacement: ReplacementData = {
        body: '{}',
    },
): Response => {
    const headers = copyResponseHeaders(origResponse?.headers);
    const body = typeof replacement.body === 'undefined' ? '{}' : replacement.body;
    const status = typeof replacement.status === 'undefined' ? origResponse.status : replacement.status;
    const statusText = typeof replacement.statusText === 'undefined' ? origResponse.statusText : replacement.statusText;
    let ok = replacement.ok;
    if (typeof ok === 'undefined') {
        ok = typeof replacement.status === 'undefined' ? origResponse.ok : isSuccessResponseStatus(status);
    }
    const redirected = typeof replacement.redirected === 'undefined'
        ? origResponse.redirected
        : replacement.redirected;
    const type = typeof replacement.type === 'undefined' ? origResponse.type : replacement.type;
    const safeStatus = getSafeResponseStatus(status);
    // Response init rejects statuses below 200, so construct safely and patch the final exposed status after.
    const responseInitStatus = safeStatus < 200 ? 200 : safeStatus;

    const modifiedResponse = new Response(body, {
        status: responseInitStatus,
        statusText,
        headers,
    });

    defineReadonlyResponseProps(modifiedResponse, {
        body,
        ok,
        redirected,
        status,
        statusText,
        type,
        url: origResponse.url,
    });

    return modifiedResponse;
};

/**
 * Creates a synthetic Response object using the provided response data.
 *
 * @param responseData replacement data for response.
 *
 * @returns Synthetic response.
 */
export const createResponse = (
    responseData: SyntheticResponseData = {
        body: '{}',
    },
): Response => {
    const body = typeof responseData.body === 'undefined' ? '{}' : responseData.body;
    const filteredDefaults = getFilteredResponseDefaults(responseData.type);
    const finalBody = typeof filteredDefaults.body === 'undefined' ? body : filteredDefaults.body;
    let status = responseData.status;
    if (typeof status === 'undefined') {
        status = typeof filteredDefaults.status === 'undefined' ? 200 : filteredDefaults.status;
    }
    let statusText = responseData.statusText;
    if (typeof statusText === 'undefined') {
        statusText = typeof filteredDefaults.statusText === 'undefined' ? 'OK' : filteredDefaults.statusText;
    }
    let ok = responseData.ok;
    if (typeof ok === 'undefined') {
        ok = typeof responseData.status === 'undefined' && typeof filteredDefaults.ok === 'undefined'
            ? true
            : isSuccessResponseStatus(status);
    }
    const redirected = typeof responseData.redirected === 'undefined' ? false : responseData.redirected;
    const type = typeof responseData.type === 'undefined' ? 'basic' : responseData.type;
    let url = filteredDefaults.url;
    if (typeof url === 'undefined') {
        url = typeof responseData.requestUrl === 'undefined' ? '' : responseData.requestUrl;
    }
    let headers = responseData.headers;
    if (typeof headers === 'undefined') {
        headers = {
            'Content-Length': finalBody === null ? '0' : String(finalBody.length),
        };
    }
    const safeStatus = getSafeResponseStatus(status);
    // Response init rejects statuses below 200, so construct safely and patch the final exposed status after.
    const responseInitStatus = safeStatus < 200 ? 200 : safeStatus;

    const response = new Response(finalBody, {
        headers,
        status: responseInitStatus,
        statusText,
    });

    defineReadonlyResponseProps(response, {
        body: finalBody,
        ok,
        redirected,
        status,
        statusText,
        type,
        url,
    });

    return response;
};

/**
 * Create new Response object using original response' properties
 * and given text as body content
 *
 * @param response original response to copy properties from
 * @param textContent text to set as body content
 */
export const forgeResponse = (response: Response, textContent: string): Response => {
    const {
        bodyUsed,
        headers,
        ok,
        redirected,
        status,
        statusText,
        type,
        url,
    } = response;

    const forgedResponse = new Response(textContent, {
        status,
        statusText,
        headers,
    });

    // Manually set properties which can't be set by Response constructor
    Object.defineProperties(forgedResponse, {
        url: { value: url },
        type: { value: type },
        ok: { value: ok },
        bodyUsed: { value: bodyUsed },
        redirected: { value: redirected },
    });

    return forgedResponse;
};
