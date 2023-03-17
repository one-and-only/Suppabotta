import RequestHelper from "../requestHelper.js";
import BaseProvider from "./../providers/BaseProvider.js";
import { createHash } from "crypto";

export default class CoinEx extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.coinex.com/v1", 0.1, 0.1, 0.3, "CoinEx");
        this._pendingTrades = {};
        this._requestHelper = new RequestHelper({
            public: {
                amount: 20,
                interval: 2
            }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/market/list`)).json();
        for (const marketIdx in markets.data) {
            const market = markets.data[marketIdx];
            if (!market.includes("RTM")) continue;

            const referenceCurrency = market.split("RTM")[1];
            this._tradingPairs[referenceCurrency] = { pair: market, enabled: true };
            this._pendingTrades[referenceCurrency] = [];
        }
    }

    async getMarketPrice(referenceCurrency) {
        const marketInfo = await (await this._requestHelper.get(`${this._apiUrl}/market/ticker?market=RTM${referenceCurrency.toUpperCase()}`)).json();
        const ticker = marketInfo.data.ticker;

        return {
            success: true,
            buy: parseFloat(ticker.sell),
            sell: parseFloat(ticker.buy)
        };
    }

    createDictText(params) {
        var keys = Object.keys(params).sort();
        var qs = keys[0] + "=" + params[keys[0]];
        for (var i = 1; i < keys.length; i++) {
            qs += "&" + keys[i] + "=" + params[keys[i]];
        }
        return qs;
    }

    createAuthorization(body) {
        return createHash("md5").update(this.createDictText(body) + `&secret_key=${this._apiSecret}`).digest("hex").toUpperCase()
    }

    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const body = {
            access_id: this._apiKey,
            market: `RTM${referenceCurrency.toUpperCase()}`,
            type: isBuy ? "buy" : "sell",
            amount: amount,
            price: price,
            tonce: Date.now()
        };
        const response = await this._requestHelper.post(
            `${this._apiUrl}/order/limit`,
            JSON.stringify(body),
            true,
            {
                "Content-Type": "application/json",
                "Authorization": this.createAuthorization(body)
            }
        );
        const responseJson = await response.json();

        if (response.status !== 200 || !responseJson.id) return false;

        this._pendingTrades.push(responseJson.id);
        return true;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        if (this._pendingTrades.length < 1) return true;

        for (const coin in this._tradingPairs) {
            if (this._pendingTrades[coin].length < 1) continue;

            const stringified = JSON.stringify(this._pendingTrades[coin])
            const params = {
                access_id: this._apiKey,
                batch_ids: stringified.substring(1, stringified.length - 1),
                market: this.coinToExchangePair(coin).pair,
                tonce: Date.now()
            }
    
            const response = await this._requestHelper.request(
                `${this._apiUrl}/order/pending/batch?${this.createDictText(params)}`,
                "DELETE",
                null,
                true,
                {
                    "Authorization": this.createAuthorization(params)
                }
            );
    
            const responseJson = await response.json();
            if (response.status !== 200 || !responseJson.id) return false;
        }

        return true;
    }

    async orderStatus(orderId) {
        let market;
        for (const orderMarket in this._pendingTrades) {
            if (!this._pendingTrades[orderMarket].includes(orderId)) continue;
            market = this.coinToExchangePair(orderMarket).pair;
        }
        if (!market) return { success: false, error: "Invalid Trade ID" }
        const params = {
            access_id: this._apiKey,
            id: orderId,
            market: market,
            tonce: Date.now()
        };
        const response = await this._requestHelper.get(
            `${this._apiUrl}/order/status?${this.createDictText(params)}`,
            true,
            {
                "Authorization": this.createAuthorization(params)
            }
        );

        const orderStatus = (await response.json()).data;

        if (response.status !== 200) return { success: false }

        return {
            success: true,
            type: orderStatus.type,
            market: market,
            price: orderStatus.price,
            quantityLeft: parseFloat(orderStatus.left)
        };
    }

    async getBalance(currency) {
        const params = {
            access_id: this._apiKey,
            tonce: Date.now()
        };
        const response = await (await this._requestHelper.get(
            `${this._apiUrl}/balance/info?${this.createDictText(params)}`,
            true,
            {
                "Authorization": this.createAuthorization(params)
            }
        )).json();

        const currencyData = response.data[currency.toUpperCase()];
        if (!currencyData) {
            return {
                success: true,
                total: 0,
                available: 0
            }
        }

        return {
            success: true,
            total: parseFloat(currencyData.available) + parseFloat(currencyData.frozen),
            available: parseFloat(currencyData.available)
        }
    }
}