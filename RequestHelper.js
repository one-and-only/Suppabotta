import rateLimit from 'axios-rate-limit';
import axios from "axios";
import { Agent as httpsAgent } from "https";

/**
 * `axios` wrapper with rate limiting. No more pesky 429s from Exchange APIs!
 */
export default class RequestHelper {
    _outbound_ip;
    _axios;
    _axios_private;

    /**
     * 
     * @param {{ public: { amount: number, interval: number }, private?: { amount: number, interval: number } }} rate_limits Public and Private rate limits for exchange
     * @param {boolean} are_limits_global Whether the rate limits apply to all endpoints instead of separate limits for public and authenticated.
     */
    constructor(rate_limits, are_limits_global, outbound_ip) {
        this._outbound_ip = outbound_ip;

        // Set these headers so we can fake being Chrome to avoid CAPTCHAs
        const axiosClient = axios.create({
            headers: {
                "SEC-CH-UA-FULL-VERSION": "122.0.6261.112",
                "UPGRADE-INSECURE-REQUESTS": "1",
                "USER-AGENT": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "VIEWPORT-WIDTH": "1470"
            },
            httpsAgent: new httpsAgent({
                localAddress: this._outbound_ip
            })
        });

        // no rate limits, so we just use the normal `axios` function
        if (rate_limits.public.interval === -1) {
            this._axios = axiosClient.request;
            this._axios_private = axiosClient.request;
            return;
        }

        this._axios = rateLimit(axiosClient, { maxRequests: rate_limits.public.amount, perMilliseconds: rate_limits.public.interval * 1000 });

        if (are_limits_global) {
            this._axios_private = this._axios;
        } else {
            this._axios = rateLimit(axiosClient, { maxRequests: rate_limits.private.amount, perMilliseconds: rate_limits.private.interval * 1000 });
        }
    }

    /**
     * Raw request making function with rate limiting
     * @param {string} url Complete URL of request
     * @param {string} method Request method. Ex: "GET"
     * @param {any} data Request `body` contents
     * @param {boolean} is_private Whether this endpoint requires API key authentication
     * @param {object} headers Headers that should be sent to the outbound server, along with any other applicable data
     * @returns {Promise<object | null>} Response data
     */
    async request(url, method, data, is_private, headers = {}) {
        const appropriate_axios = is_private ? this._axios_private : this._axios;
        let body;

        if (method === "POST")
            if (headers["Content-Type"] === "application/json") body = JSON.stringify(data);
            else body = data;

        return (await appropriate_axios({
            url: url,
            method: method,
            headers: headers,
            data: body ?? null
        })).data;
    }

    /**
     * Make a rate-limited POST request
     * @param {string} url Complete URL of request
     * @param {*} data request `body` contents
     * @param {*} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {*} headers Request headers
     * @returns {Promise<object | null>} Response data
     */
    async post(url, data={}, is_private=false, headers={}) {
        return this.request(url, "POST", data, is_private, headers);
    }

    /**
     * Make a rate-limited GET request
     * @param {string} url Complete URL of request
     * @param {*} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {*} headers Request headers
     * @returns {Promise<object | null>} Response data
     */
    async get(url, is_private=false, headers={}) {
        return this.request(url, "GET", {}, is_private, headers);
    }

}