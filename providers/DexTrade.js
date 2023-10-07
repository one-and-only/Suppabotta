import BaseProvider from "./BaseProvider.js";
import { createHash } from "crypto";
import RequestHelper from "../RequestHelper.js";

// TODO fix private requests
// TODO this entire connector needs to be modernized, not being updated at the moment for the new arbitrage algorithms
// it can't find required parameter even though it's passed in

export default class DexTrade extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.dex-trade.com/v1", 0, 0, 0.05, true, [0, 1], "", "DexTrade");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const symbols = await (await this._requestHelper.get(`${this._apiUrl}/public/symbols`)).json();

        for (const symbolIdx in symbols.data) {
            const symbol = symbols.data[symbolIdx];
            if (symbol.base === "RTM") {
                this._tradingPairs[symbol.quote] = { pair: symbol.pair, enabled: true };
                this._minTradeVolumes[symbol.pair] = Number.MIN_VALUE; // TODO find the actual min trade volume (Dex-Trade API doesn't have it)
            }
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency="RTM") {
        const orderBookResponse = await this._requestHelper.get(`${this._apiUrl}/public/book?pair=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}`);

        if (orderBookResponse.status === 400) return { success: false, error: "Invalid reference currency" }

        const data = (await orderBookResponse.json()).data;
        return {
            success: true,
            sellPrice: data.buy[0].rate,
            sellDepth: data.buy[0].volume,
            buyPrice: data.sell[0].rate,
            buyDepth: data.sell[0].volume
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
    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        const body = {
            pair: this.coinsToExchangePair([baseCurrency, referenceCurrency]),
            rate: price,
            type: isBuy ? 0 : 1,
            type_trade: 0,
            volume: baseAmount,
            request_id: `${Date.now()}`
        };
        const createOrderResponse = await this._requestHelper.post(
            `${this._apiUrl}/private/create-order`,
            JSON.stringify(body),
            true,
            {
                "Content-Type": "application/json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body.pair + body.rate + body.type + body.type_trade + body.volume + body.request_id + this._apiSecret).digest("hex")
            }
        );

        if (createOrderResponse.status === 200) {
            const pendingOrder = await createOrderResponse.json();
            this._pendingTrades.push(pendingOrder.data.id);
            return true;
        }
        return false;
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async cancelAllPending() {
        for (const pendingTradeId of this._pendingTrades) {
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

            if (res.status !== 200) return false;
        }
        this._pendingTrades = [];

        return true;
    }

    async orderStatus(orderId) {
        const body = JSON.stringify({
            order_id: orderId,
            request_id: Date.now()
        });
        const order = await this._requestHelper.post(
            `${this._apiUrl}/private/get-order`,
            body,
            true,
            {
                "Content-Type": "application.json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
            }
        );
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
            request_id: `${Date.now()}`
        });
        const balances = await this._requestHelper.post(
            `${this._apiUrl}/private/balances`,
            body,
            true,
            {
                "content-type": "application/json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
            }
        );
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