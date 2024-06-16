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
    _redis_conection;
    _base_rate_limits;
    _rate_limits_exist;
    _rate_limits;
    _are_limits_global;

    /**
     * @param {{ public: { amount: number, interval: number }, private?: { amount: number, interval: number } }} rate_limits Public and Private rate limits for exchange
     * @param {boolean} are_limits_global Whether the rate limits apply to all endpoints instead of separate limits for public and authenticated.
     * @param {string} outbound_ip IP address corresponding to the interface requests should go out of
     * @param {IORedis} redis_connection Redis connection object used to gather the number of trading threads running on 
     */
    constructor(rate_limits, are_limits_global, outbound_ip, redis_connection) {
        this._outbound_ip = outbound_ip;
        this._redis_conection = redis_connection;
        this._rate_limits_exist = rate_limits.public.interval !== -1;
        this._are_limits_global = are_limits_global;
        this._rate_limits = rate_limits;

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
        if (!this._rate_limits_exist) {
            this._axios = axiosClient.request;
            this._axios_private = axiosClient.request;
            return;
        }

        this._axios = rateLimit(axiosClient, { maxRequests: this._rate_limits.public.amount, perMilliseconds: this._rate_limits.public.interval * 1000 });

        if (this._are_limits_global) {
            this._axios_private = this._axios;
        } else {
            this._axios = rateLimit(axiosClient, { maxRequests: this._rate_limits.private.amount, perMilliseconds: this._rate_limits.private.interval * 1000 });
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
     * Update the effective rate limits for this request helper, based on the number of running trading threads
     * @param {string} username Username that should be checked for the number of running trading threads
     */
    async recomputeRateLimits(username) {
        if (!this._rate_limits_exist) return;

        const numRunningTradingThreads = parseInt(await this._redis_conection.get(`runningThreads_${username}`));

        this._axios.setRateLimitOptions({ maxRequests: this._rate_limits.public.amount / numRunningTradingThreads, perMilliseconds: this._rate_limits.public.interval * 1000 });

        if (this._are_limits_global) {
            this._axios_private = this._axios;
            return;
        }

        this._axios_private.setRateLimitOptions({ maxRequests: this._rate_limits.private.amount / numRunningTradingThreads, perMilliseconds: this._rate_limits.private.interval * 1000 });
    }

    /**
     * Make a rate-limited POST request
     * @param {string} url Complete URL of request
     * @param {object | null} data request `body` contents
     * @param {boolean} is_private Whether this endpoint is authenticated. Mainly used for rate limiting.
     * @param {object} headers Request headers
     * @returns {Promise<object>} Response data
     */
    async post(url, data=null, is_private=false, headers={}) {
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