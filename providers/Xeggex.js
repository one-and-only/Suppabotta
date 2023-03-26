import BaseProvider from "../providers/BaseProvider.js";
import RequestHelper from "../requestHelper.js";
import { createHmac, randomBytes } from 'crypto';
import Logger from "../Logger.js";

export default class Xeggex extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://xeggex.com/api/v2", 0.2, 0.2, 0.62, true, "Xeggex");
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
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/market/getlist`)).json();

        for (const market of markets) {
            if (!market.symbol.startsWith("RTM")) continue;

            this._tradingPairs[market.secondaryAsset.ticker] = { pair: market.symbol, enabled: true };
            this._minTradeVolumes[market.symbol] = market.minimumQuantity;
        }
    }

    authHeaders(url, body) {
        const nonce = `${Date.now()}`;

        return {
            "Content-Type": "application/json",
            "X-API-KEY": this._apiKey,
            "X-API-NONCE": nonce,
            "X-API-SIGN": createHmac("sha256", this._apiSecret).update(this._apiKey + url + body + nonce).digest("hex")
        };
    }

    async getMarketPrice(referenceCurrency) {
        const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/market/getorderbookbysymbol/${this.coinToExchangePair(referenceCurrency).replace("/", "_")}`)).json();

        const bid = orderBook.bids[0];
        const ask = orderBook.asks[0];

        return {
            success: true,
            sellPrice: bid.numberprice,
            sellDepth: parseFloat(bid.quantity),
            buyPrice: ask.numberprice,
            buyDepth: parseFloat(ask.quantity)
        };
    }

    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const url = `${this._apiUrl}/createorder`;
        const body = JSON.stringify({
            "userProvidedId": randomBytes(16).toString("hex"),
            "symbol": this.coinToExchangePair(referenceCurrency.toUpperCase()),
            "side": isBuy ? "buy" : "sell",
            "type": "limit",
            "quantity": `${amount}`,
            "price": `${price}`,
            "strictValidate": false
        });

        try {
            const response = await (await this._requestHelper.post(
                url,
                body,
                true,
                this.authHeaders(url, body)
            )).text();

            if (parseFloat(response.remainQuantity) > 0) {
                this._pendingTrades.push(response.id);
            }
        } catch (e) {
            Logger.error(this._name, `submitOrder_${isBuy ? "buy" : "sell"}`, `Failed to submit order`);
            return;
        }
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        for (const orderId of this._pendingTrades) {
            const url = `${this._apiUrl}/cancelOrder`;
            const body = JSON.stringify({
                id: orderId
            });

            await this._requestHelper.post(
                url,
                body,
                true,
                this.authHeaders(url, body)
            );
        }

        this._pendingTrades = [];
    }

    async orderStatus(orderId) {
        const url = `${this._apiUrl}/getorder/${orderId}`;
        const orderStatus = await (await this._requestHelper.get(url, true, this.authHeaders(url, ""))).json();

        if (orderStatus.error) {
            Logger.error(this._name, "orderStatus", `Failed to get order status (${orderStatus.error.message}; ${orderStatus.error.description})`);
            return;
        }

        if (parseFloat(orderStatus.remainQuantity) === 0) {
            return {
                success: false,
                error: "Order already fulfilled"
            };
        }

        return {
            success: true,
            type: `${orderStatus.type.toUpperCase()}_${orderStatus.side.toUpperCase()}`,
            market: orderStatus.result.Exchange,
            price: parseFloat(orderStatus.price),
            quantityLeft: parseFloat(orderStatus.remainQuantity)
        };
    }

    async getBalance(currency) {
        const url = `${this._apiUrl}/balances`;
        const balances = await (await this._requestHelper.get(url, true, this.authHeaders(url, ""))).json();

        if (balances.error) {
            Logger.error(this._name, "getBalance", `Failed to get balance (${balances.error.message}; ${balances.error.description})`)
            return;
        }

        for (const balance of balances) {
            if (balance.asset === currency.toUpperCase()) {
                const available = parseFloat(balance.available);
                const pending = parseFloat(balance.pending);
                return {
                    success: true,
                    total: available + pending,
                    available: available
                };
            }
        }

        return {
            success: false,
            error: "Invalid currency"
        };
    }
}