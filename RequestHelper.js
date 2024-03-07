import Bottleneck from "bottleneck";
import fetch from "node-fetch";
import * as https from "https";

/**
 * `node-fetch` wrapper with rate limiting. No more pesky 429s from Exchange APIs!
 */
export default class RequestHelper {
    _fetch;
    _fetch_private;
    _limiter;
    _limiter_private;

    /**
     * 
     * @param {{ public: { amount: number, interval: number }, private: { amount: number, interval: number } }} rate_limits Public and Private rate limits for exchange
     * @param {boolean} areLimitsGlobal Whether the rate limits apply to all endpoints instead of separate limits for public and authenticated.
     */
    constructor(rate_limits, areLimitsGlobal) {
        // no rate limits, so we just use the normal `fetch` function
        if (rate_limits.public.interval === -1) {
            this._fetch = fetch;
            this._fetch_private = fetch;
            return;
        }

        this._limiter = new Bottleneck({
            reservoir: rate_limits.public.amount,
            reservoirRefreshInterval: rate_limits.public.interval * 1000,
            reservoirRefreshAmount: rate_limits.public.amount
        });

        if (areLimitsGlobal) {
            this._limiter_private = this._limiter;
        } else {
            this._limiter_private = new Bottleneck({
                reservoir: rate_limits.private.amount,
                reservoirRefreshInterval: rate_limits.private.interval,
                reservoirRefreshAmount: rate_limits.private.amount
            });
        }

        this._fetch = this._limiter.wrap(fetch);
        this._fetch_private = this._limiter_private.wrap(fetch);
    }

    /**
     * Raw request making function with rate limiting
     * @param {url} url Complete URL of request
     * @param {string} method Request method. Ex: "GET"
     * @param {any} data Request `body` contents
     * @param {boolean} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {object} headers 
     * @returns {Promise<Response>} Response data
     */
    async request(url, method, data, is_private, headers = {}) {
        const appropriate_fetch = is_private ? this._fetch_private : this._fetch;

        let requestOptions = {
            method: method,
            headers: headers,
            agent: new https.Agent({
                localAddress: process.env.APPLICABLE_REQUEST_IP
            })
        };

        if (method === "POST")
            if (headers["Content-Type"] === "application/json") requestOptions["body"] = JSON.stringify(data);
            else requestOptions["body"] = data;

        return await appropriate_fetch(url, requestOptions);
    }

    /**
     * Make a rate-limited POST request
     * @param {string} url Complete URL of request
     * @param {*} data request `body` contents
     * @param {*} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {*} headers Request headers
     * @returns {Promise<Response>} Response data
     */
    async post(url, data={}, is_private=false, headers={}) {
        return this.request(url, "POST", data, is_private, headers);
    }

    /**
     * Make a rate-limited GET request
     * @param {string} url Complete URL of request
     * @param {*} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {*} headers Request headers
     * @returns {Promise<Response>} Response data
     */
    async get(url, is_private=false, headers={}) {
        return this.request(url, "GET", {}, is_private, headers);
    }

}