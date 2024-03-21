import BaseProvider from "./BaseProvider.js";
import { createHash } from "crypto";
import RequestHelper from "../RequestHelper.js";

import Bluebird from "bluebird";
const { map: promiseMap } = Bluebird;

// really small numbers get converted into scientific notation otherwise
// talked to API support and they said they don't support this notation (i.e. it's bad)
import BigNumber from "bignumber.js";

//* NOTE about this API:
// instead of using objects for setting the request's data, we need to use Map
// because the Dex-Trade API needs to sort parameters alphabetically >:(
// insertion order must be respected in code to achieve this
export default class DexTrade extends BaseProvider {
    constructor(outboundIp, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, apiSecret, apiKey, "https://api.dex-trade.com/v1", baseCurrency, 0.1, 0.1, 0.05, false, [0, 1], "", "DexTrade");
        this._requestHelper = new RequestHelper(
            {
                public: {
                    amount: -1,
                    interval: -1
                }
            },
            true,
            this._outboundIp
        );
    }

    /**
     * Generate the necessary authentication headers required when making private requests
     * @param {Map<string, any>} data 
     * @returns {{"login-token":string, "X-Auth-Sign":string}}
     */
    generatePrivateHeaders(data) {
        return {
            "login-token": this._apiKey,
            "X-Auth-Sign": createHash("sha256").update(
                Array.from(data.values()).reduce((accumulator, current) => accumulator + current.toString(), "") + this._apiSecret
            ).digest("hex")
        };
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async getAllMarkets() {
        const symbols = await (await this._requestHelper.get(`${this._apiUrl}/public/symbols`)).json();

        return symbols.data.map(symbol => {
            return {
                referenceCurrency: symbol.quote,
                baseCurrency: symbol.base
            };
        });
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/public/book?pair=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}`)).json();

            return {
                bid: orderBook.data.buy.map(val => { return { price: val.rate, amount: val.volume } }),
                ask: orderBook.data.sell.map(val => { return { price: val.rate, amount: val.volume } })
            };
        } catch (e) {
            return {
                bid: [],
                ask: []
            };
        }
    }

    async allTradingPairs() {
        const symbols = await (await this._requestHelper.get(`${this._apiUrl}/public/symbols`)).json();

        for (const symbolIdx in symbols.data) {
            const symbol = symbols.data[symbolIdx];
            this._minTradeVolumes[symbol.pair] = 28.125; // Dex-Trade Trading UI says 28.125 minimum RTM for all RTM pairs
            if (symbol.base === this._baseCurrency) {
                this._tradingPairs[symbol.quote] = { pair: symbol.pair, enabled: true };
            }
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency = "RTM") {
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
     * @param {number} amount amount of `baseAmount` you're selling or buying
     * @param {number} price price per `baseAmount`
     * @param {string} referenceCurrency currency you're pairing `baseAmount` with
     * @param {boolean} isBuy Whether the trade is of type "buy" or not (type "sell")
     * @returns {boolean} success or failure
     */
    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        const body = new Map([
            ["pair", this.coinsToExchangePair([baseCurrency, referenceCurrency])],
            ["rate", new BigNumber(price).toString()],
            ["request_id", `${Date.now()}`],
            ["type", +!isBuy],
            ["type_trade", 0],
            ["volume", new BigNumber(baseAmount).toString()],
        ]);
        const privateHeaders = this.generatePrivateHeaders(body);

        const createOrderResponse = await this._requestHelper.post(
            `${this._apiUrl}/private/create-order`,
            Object.fromEntries(body),
            true,
            {
                "Content-Type": "application/json",
                ...(privateHeaders)
            }
        );

        if (createOrderResponse.status === 200) {
            const pendingOrder = await createOrderResponse.json();
            this._pendingTrades.push({ id: pendingOrder.data.id, referenceCurrency: referenceCurrency, baseCurrency: baseCurrency, amount: baseAmount, price: price, isBuy: isBuy });
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
            const body = new Map([
                ["order_id", new BigNumber(pendingTradeId).toString()],
                ["request_id", `${Date.now()}`]
            ]);
            const res = await this._requestHelper.post(
                `${this._apiUrl}/private/delete-order`,
                Object.fromEntries(body),
                true,
                {
                    "Content-Type": "application/json",
                    ...(this.generatePrivateHeaders(body))
                }
            );

            if (res.status !== 200) return false;
        }
        this._pendingTrades = [];

        return true;
    }

    getPendingOrders() {
        return this._pendingTrades;
    }

    async prunePendingOrders() {
        this._pendingTrades = (await promiseMap(
            this._pendingTrades,
            async order => {
                const orderStatus = await this.orderStatus(order.id);
                if (orderStatus.success && orderStatus.quantityLeft > 0) return order;

                return "";
            }
        )).filter(x => x !== "");
    }

    async orderStatus(orderId) {
        const body = new Map([
            ["order_id", new BigNumber(orderId).toString()],
            ["request_id", `${Date.now()}`]
        ])
        const order = await this._requestHelper.post(
            `${this._apiUrl}/private/get-order`,
            Object.fromEntries(body),
            true,
            {
                "Content-Type": "application.json",
                ...(this.generatePrivateHeaders(body))
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

        const body = new Map([
            ["request_id", `${Date.now()}`]
        ]);

        const balances = await this._requestHelper.post(
            `${this._apiUrl}/private/balances`,
            Object.fromEntries(body),
            true,
            {
                "Content-Type": "application/json",
                ...(this.generatePrivateHeaders(body))
            }
        );

        if (balances.status !== 200) return { success: false, error: await balances.text() };

        const balanceData = await balances.json();
        if (!balanceData.status) return { success: false, error: balanceData.error };

        const currencyData = balanceData.data.list.filter((balance) => {
            return balance.currency.iso3 === currency;
        })[0];

        return {
            success: true,
            total: currencyData.balance,
            available: currencyData.balance_available
        };
    }
}