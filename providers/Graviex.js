import BaseProvider from "./BaseProvider.js";
import { createHmac } from "crypto";

export default class Graviex extends BaseProvider {
    constructor(outboundIp, requestHelper, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, requestHelper, apiSecret, apiKey, "https://graviex.net/webapi/v3", baseCurrency, 0.3, 0.3, 0.01, true, [0, 1], "", "Graviex");
    }

    /**
     * Convert a Map data structure into HTTP query parameters
     * @param {Map<string, any>} map Map of query parameters
     * @returns 
     */
    mapToQueryString(map) {
        return Array.from(map).map((value) => `${value[0]}=${value[1]}`).join("&");
    }

    /**
     * Generate the signature which is used in authenticated API requests
     * @param {string} httpVerb HTTP verb used in the request (Ex: `GET`)
     * @param {string} uri The path that was queried from the API (Ex: `/webapi/v3/markets`)
     * @param {Map<string, any>} query Query parameters sorted in alphabetical order
     */
    generateSignature(httpVerb, uri, query) {
        return createHmac("sha256", this._apiSecret).update(`${httpVerb}|${uri}|${this.mapToQueryString(query)}`).digest("hex");
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async getAllMarkets() {
        const markets = await this._requestHelper.get(`${this._apiUrl}/markets.json`);

        return markets.map(x => {
            const split = x.name.split("/");

            return {
                baseCurrency: split[0],
                referenceCurrency: split[1]
            };
        });
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        const params = new Map([
            ["access_key", this._apiKey],
            ["asks_limit", 50],
            ["bids_limit", 50],
            ["market", this.coinsToExchangePair([baseCurrency.toLowerCase(), referenceCurrency.toLowerCase()])],
            ["tonce", Date.now()],
        ]);

        const orderBook = await this._requestHelper.get(`${this._apiUrl}/order_book.json?${this.mapToQueryString(params)}&signature=${this.generateSignature("GET", "/webapi/v3/order_book.json", params)}`, true);

        if (orderBook.error) {
            return {
                bid: [],
                ask: []
            };
        }

        return orderBook;
    }

    async getMarketPrice(referenceCurrency, baseCurrency = "RTM") {
        const priceInfo = await this._requestHelper.get(`${this._apiUrl}/depth.json?market=${this.coinsToExchangePair([baseCurrency.toLowerCase(), referenceCurrency.toLowerCase()])}&limit=1`);

        if (priceInfo.error) {
            return {
                success: false,
                error: priceInfo.error.message
            };
        }

        return {
            success: true,
            buyPrice: parseFloat(priceInfo.asks[0][0]),
            buyDepth: parseFloat(priceInfo.asks[0][1]),
            sellPrice: parseFloat(priceInfo.bids[0][0]),
            sellDepth: parseFloat(priceInfo.bids[0][1])
        };
    }

    async allTradingPairs() {
        const pairs = await this._requestHelper.get(`${this._apiUrl}/tickers.json`);

        for (const pairIdx of Object.keys(pairs)) {
            const pair = pairs[pairIdx].name.toUpperCase();

            this._tradingPairs[pair.split("/")[1]] = { pair: pair, enabled: true };
            this._minTradeVolumes[pair] = 0;
        }
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async orderStatus(orderId) {
    }

    async getBalance(currency) {
    }
}