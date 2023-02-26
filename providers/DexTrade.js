import BaseProvider from "./../providers/BaseProvider.js";
import { createHash } from "crypto";
import map from "bluebird";
import RequestHelper from "../requestHelper.js";

export default class QTrade extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.dex-trade.com/v1", 0, 0, 0.05);
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            }
        });
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const symbols = await (await this._requestHelper.get(`${this._apiUrl}/public/symbols`)).json();

        for (const symbolIdx in symbols.data) {
            const symbol = symbols.data[symbolIdx];
            if (symbol.base === "RTM")
                this._tradingPairs[symbol.quote] = symbol.pair;
        }
    }

    async getMarketPrice(referenceCurrency) {
        const orderBookResponse = await this._requestHelper.get(`${this._apiUrl}/public/book?pair=RTM${referenceCurrency}`);

        if (orderBookResponse.status === 400) return { success: false, error: "Invalid reference currency" }

        const data = (await orderBookResponse.json()).data;
        return {
            success: true,
            sell: data.buy[0].rate,
            buy: data.sell[0].rate,
        };
    }

    /**
     * 
     * @param {number} amount amount of RTM you're selling or buying
     * @param {number} price price per RTM
     * @param {string} referenceCurrency currency you're pairing RTM with
     * @param {boolean} isBuy Whether the trade is of type "buy" or not (type "sell")
     * @returns {boolean} success or failure
     */
    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const body = {
            pair: `RTM${referenceCurrency.toUpperCase()}`,
            rate: price,
            request_id: Date.now(),
            type: isBuy ? 0 : 1,
            type_trade: 0,
            volume: amount
        };
        const createOrderResponse = await this._requestHelper.post(
            `${this._apiUrl}/private/create-order`,
            JSON.stringify(body),
            true,
            {
                "Content-Type": "application/json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body.pair + body.rate + body.request_id + body.type + body.type_trade + body.volume + this._apiSecret).digest("hex")
            }
        );

        if (createOrderResponse.status === 200) {
            const pendingOrder = await createOrderResponse.json();
            this._pendingTrades.push(pendingOrder.data.id);
            return true;
        }

        console.log(await createOrderResponse.json())
        return false;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        const didSucceeds = await map(this._pendingTrades, async (pendingTradeId) => {
            const body = JSON.stringify({
                order_id: pendingTradeId,
                request_id: Date.now()
            });
            const res = await this._requestHelper.post(
                `${this._apiUrl}/private/delete-order`,
                body,
                true,
                {
                    "Content-Type": "application/json",
                    "login-token": this._apiKey,
                    "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
                }
            );

            if (res.status === 200) return { success: true };
            else return { success: false, response: await res.text() }
        });
        this._pendingTrades = [];

        for (const didSucceed in didSucceeds)
            if (didSucceed !== true) return false;

        return true;
    }

    async orderStatus(orderId) {
        const body = JSON.stringify({
            order_id: orderId,
            request_id: Date.now()
        });
        const order = await fetch(`${this._apiUrl}/private/get-order`, {
            method: "POST",
            headers: {
                "Content-Type": "application.json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
            },
            body: body
        });
        if (order.status !== 200) return { sucess: false, error: await order.text() };

        const data = await order.json();
        return {
            success: true,
            type: (data.type === 0) ? "buy" : "sell",
            market: data.market,
            price: data.price,
            quantityLeft: data.volume - data.volume_done
        };
    }

    async getBalance(currency) {
        currency = currency.toUpperCase();

        const body = JSON.stringify({
            request_id: Date.now()
        });
        const balances = await fetch(`${this._apiUrl}/private/balances`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
            },
            body: body
        });
        if (balances.status === 200) return { success: false, error: await balances.text() };

        const data = await balances.json();
        if (!data.status) return { success: false, error: data.error };

        const currencyData = balances.filter((balance) => {
            return balance.iso3 === currency;
        })[0];

        return {
            success: true,
            total: currencyData.balance,
            available: currencyData.balance_available
        };
    }
}