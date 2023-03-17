import RequestHelper from "../requestHelper.js";
import BaseProvider from "./../providers/BaseProvider.js";
import { encode as base64Encode } from "js-base64";
import { createHmac } from "crypto";
import Logger from "../Logger.js";

// TODO order status needs to be finished

export default class P2B extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.p2pb2b.com/api/v2", 0, 0, 500, "P2B");
        this._requestHelper = new RequestHelper({
            public: { amount: 10, interval: 1 }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/public/markets`)).json();

        for (const marketIdx in markets.result) {
            const market = markets.result[marketIdx];
            if (market.stock !== "RTM") continue;

            this._tradingPairs[market.money] = { pair: market.name, enabled: true };
            this._minTradeVolumes[market.name] = parseFloat(market.limits.min_amount)
        }
    }

    async getMarketPrice(referenceCurrency) {
        const priceData = await (await (this._requestHelper.get(`${this._apiUrl}/public/depth/result?market=${this.coinToExchangePair(referenceCurrency.toUpperCase()).pair}&limit=1`))).json();

        return {
            success: true,
            sellPrice: parseFloat(priceData.result.bids[0][0]),
            sellDepth: parseFloat(priceData.result.bids[0][1]),
            buyPrice: parseFloat(priceData.result.asks[0][0]),
            buyDepth: parseFloat(priceData.result.asks[0][1])
        };
    }

    generateAuthHeaders(body) {
        const base64Body = base64Encode(JSON.stringify(body));
        return {
            "X-TXC-APIKEY": this._apiKey,
            "X-TXC-PAYLOAD": base64Body,
            "X-TXC-SIGNATURE": createHmac("sha512", this._apiSecret).update(base64Body).digest("hex"),
            "Content-Type": "application/json"
        };
    }

    async submitOrder(amount, price, referenceCurrency, side) {
        const market = this.coinToExchangePair(referenceCurrency.toUpperCase()).pair;

        const body = {
            market: market,
            side: side,
            amount: `${amount}`,
            price: `${price}`,
            request: "/api/v2/order/new",
            nonce: Date.now()
        };
        const response = await (await this._requestHelper.post(
            `${this._apiUrl}/order/new`,
            body,
            true,
            this.generateAuthHeaders(body)
        )).json();

        if (!response.success) {
            Logger.error("P2B", `submitOrder_${side}`, response.message);
            return false;
        }

        this._pendingTrades.push({ id: response.result.orderId, market: market });
        return true;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "buy");
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "sell");
    }

    async cancelAllPending() {
        for (const pendingTrade of this._pendingTrades) {
            const body = {
                market: pendingTrade.market,
                orderId: pendingTrade.id,
                request: "/api/v2/order/cancel",
                nonce: Date.now()
            };

            const response = await (await this._requestHelper.post(
                `${this._apiUrl}/order/cancel`,
                body,
                true,
                this.generateAuthHeaders(body)
            )).json();

            if (!response.success) {
                Logger.error("P2B", `submitOrder_${pendingTrade.id}`, response.message);
                return false;
            }
        }

        this._pendingTrades.length = 0;
    }

    async orderStatus(orderId) {
        const body = {
            request: "/api/v2/orders",
            // get the market from the pendingTrades array because it isn't a parameter in BaseProvider class
            market: this._pendingTrades.filter(trade => trade.id === orderId)[0].market,
            nonce: Date.now(),
            limit: 100
        };

        const response = await (await this._requestHelper.post(
            `${this._apiUrl}/orders`,
            body,
            true,
            this.generateAuthHeaders(body)
        )).json();

        if (!response.success) {
            Logger.error("P2B", `orderStatys_${orderId}`, response.message);
            return false;
        }
    }

    async getBalance(currency) {
        const body = {
            currency: currency.toUpperCase(),
            request: "/api/v2/account/balance",
            nonce: Date.now()
        };
        let headers = this.generateAuthHeaders(body);

        const currencyBalance = await (await this._requestHelper.post(`${this._apiUrl}/account/balance`, body, true, headers)).json();

        return {
            success: true,
            total: parseFloat(currencyBalance.result.available) + parseFloat(currencyBalance.result.freeze),
            available: parseFloat(currencyBalance.result.available)
        }
    }
}