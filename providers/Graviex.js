import RequestHelper from "../requestHelper.js";
import BaseProvider from "../providers/BaseProvider.js";
import { createHmac } from "crypto";
import Logger from "../Logger.js";

//! this exchange didn't update their wallets

export default class Graviex extends BaseProvider {
    _urlPathPrefix;

    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://graviex.net/webapi/v3", 0.2, 0.2, 0.002, true, "Graviex");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            },
            private: {
                amount: 6000,
                interval: 300
            }
        }, false);
        this._urlPathPrefix = "/webapi/v3";
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async getMarketPrice(referenceCurrency) {
        const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/depth?market=${this.coinToExchangePair(referenceCurrency.toUpperCase()).pair}&limit=1`)).json();

        if (orderBook.error) {
            Logger.error("Graviex", "orderStatus", `${response.error.message} (code ${response.error.code})`);
            return {
                success: false,
                error: orderBook.error.message,
                errorCode: orderBook.error.code
            };
        }

        return {
            success: true,
            buyPrice: parseFloat(orderBook.asks[0]),
            buyDepth: parseFloat(orderBook.asks[1]),
            sellPrice: parseFloat(orderBook.bids[0]),
            sellDepth: parseFloat(orderBook.bids[1])
        };
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/markets.json`)).json();

        for (const marketIdx in markets) {
            const market = markets[marketIdx];
            if (!market.id.includes("rtm")) continue;

            this._tradingPairs[market.name.split("/")[1]] = { pair: market.id, enabled: true };
            this._minTradeVolumes[market.name] = Number.MIN_VALUE; // TODO get actual min trade volume
        }
    }

    createDictText(params) {
        var keys = Object.keys(params).sort();
        var qs = keys[0] + "=" + params[keys[0]];
        for (var i = 1; i < keys.length; i++) {
            qs += "&" + keys[i] + "=" + params[keys[i]];
        }
        return qs;
    }

    createAuthentication(verb, path, params) {
        return createHmac("sha256", this._apiSecret).update(`${verb}|${path}|${params}`).digest("hex")
    }

    async submitOrder(amount, price, referenceCurrency, isBuy) {
        let params = this.createDictText({
            access_key: this._apiKey,
            tonce: Date.now(),
            market: this.coinToExchangePair(referenceCurrency.toUpperCase()).pair,
            side: isBuy ? "buy" : "sell",
            volume: amount,
            price: price,
            ord_type: "limit"
        });
        params += `&signature=${this.createAuthentication("POST", `${this._urlPathPrefix}/orders.json`, params)}`;
        const response = await (await this._requestHelper.post(
            `${this._apiUrl}/orders.json`,
            params,
            true,
            {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        )).json();

        if (response.error?.code) {
            Logger.error("Graviex", `submitOrder_${isBuy ? "buy" : "sell"}`, `${response.error.message} (code ${response.error.code})`)
            return {
                success: false,
                error: `${response.error.message}`
            };
        }

        Logger.success("Graviex", `submitOrder_${isBuy ? "buy" : "sell"}`, `Successfully added ${isBuy ? "buy" : "sell"} order for ${amount} ${referenceCurrency.toUpperCase()}`);
        // TODO only store the order ID (find out what the response looks like)
        this._pendingTrades.push(response);
        return true;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        for (const trade in this._pendingTrades) {
            console.log(trade);
        }

        return true;
    }

    async orderStatus(orderId) {
        let params = this.createDictText({
            access_key: this._apiKey,
            id: orderId,
            tonce: Date.now()
        });
        params += `&signature=${this.createAuthentication("GET", `${this._urlPathPrefix}/order.json`, params)}`;

        const response = await (await this._requestHelper.get(`${this._apiUrl}/order.json?${params}`, true)).json();
        if (response.error?.code) {
            Logger.error("Graviex", "orderStatus", `${response.error.message} (code ${response.error.code})`);
            return {
                success: false,
                error: response.error.message
            };
        }

        // TODO find what the order status actually is
    }

    async getBalance(currency) {
        return {
            success: false,
            error: "Graviex does not support balance querying."
        };
    }
}
