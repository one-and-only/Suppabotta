import BaseProvider from "./BaseProvider.js";
import { createHash } from "crypto";

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
    constructor(outboundIp, requestHelper, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, requestHelper, apiSecret, apiKey, "https://api.dex-trade.com/v1", baseCurrency, 0.1, 0.1, 0.05, false, [0, 1], "", "DexTrade");
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
        const symbols = await this._requestHelper.get(`${this._apiUrl}/public/symbols`);

        return symbols.data.map(symbol => {
            return {
                referenceCurrency: symbol.quote,
                baseCurrency: symbol.base
            };
        });
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const orderBook = await this._requestHelper.get(`${this._apiUrl}/public/book?pair=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}`);

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
        const symbols = await this._requestHelper.get(`${this._apiUrl}/public/symbols`);

        for (const symbolIdx in symbols.data) {
            const symbol = symbols.data[symbolIdx];
            //! this puts 28.125 for every single pair
            // this was done because at the time of writing this connector, RTM was the only base currency that this bot would target
            // now the user can choose the base currency
            // TODO: find a way to store the min trade volumes for each pair
            this._minTradeVolumes[symbol.pair] = 28.125; // Dex-Trade Trading UI says 28.125 minimum RTM for all RTM pairs
            if (symbol.base === this._baseCurrency) {
                this._tradingPairs[symbol.quote] = { pair: symbol.pair, enabled: true };
            }
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency = "RTM") {
        const orderBook = await this._requestHelper.get(`${this._apiUrl}/public/book?pair=${baseCurrency.toUpperCase()}${referenceCurrency.toUpperCase()}`);

        if (!orderBook.status) return { success: false, error: "Invalid reference currency" }

        return {
            success: true,
            sellPrice: orderBook.data.buy[0].rate,
            sellDepth: orderBook.data.buy[0].volume,
            buyPrice: orderBook.data.sell[0].rate,
            buyDepth: orderBook.data.sell[0].volume
        };
    }

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

        const pendingOrder = await this._requestHelper.post(
            `${this._apiUrl}/private/create-order`,
            Object.fromEntries(body),
            true,
            {
                "Content-Type": "application/json",
                ...(privateHeaders)
            }
        );

        return { success: pendingOrder.status, id: pendingOrder.status ? pendingOrder.data.id : "" };
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async orderStatus(orderId) {
        const body = new Map([
            ["order_id", new BigNumber(orderId).toString()],
            ["request_id", `${Date.now()}`]
        ]);

        const orderStatus = await this._requestHelper.post(
            `${this._apiUrl}/private/get-order`,
            Object.fromEntries(body),
            true,
            {
                "Content-Type": "application.json",
                ...(this.generatePrivateHeaders(body))
            }
        );

        if (!orderStatus.status) return { sucess: false, error: orderStatus.error };

        return {
            success: true,
            type: (orderStatus.data.type === 0) ? "buy" : "sell",
            market: orderStatus.data.market,
            price: orderStatus.data.price,
            quantityLeft: orderStatus.data.volume - orderStatus.data.volume_done
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

        if (!balances.status) return { success: false, error: balances.error };

        const currencyData = balances.data.list.filter((balance) => {
            return balance.currency.iso3 === currency;
        })[0];

        return {
            success: true,
            total: currencyData.balance,
            available: currencyData.balance_available
        };
    }
}