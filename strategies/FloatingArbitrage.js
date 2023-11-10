import BaseStrategy from "./BaseStrategy.js";
import Logger from "../Logger.js";
import { promisify } from 'node:util';
import Bluebird from "bluebird";
import BaseProvider from "../providers/BaseProvider.js";

const { map: promiseMap } = Bluebird;
const sleep = promisify(setTimeout);

export default class FloatingArbitrageStrategy extends BaseStrategy {
    _maxInvPct;
    _inventoryDefinition;
    _unfitToRun;
    _maxPriceDropPct;

    /**
    * Check if this algorithm can run with the condition of the user's exchange accounts
    */
    async fitToRun() {
        // gather and check the balances of the user against the defined inventory
        // simulatenously calculates whether the algorithm is fit to run based on those balances
        Logger.info("FloatingArbitrage", "fitToRun", "Verifying existence of defined inventory", this._socketBroadcaster);

        this._unfitToRun = !((await promiseMap(this._connectors, async connector => {
            return (await promiseMap(Object.keys(this._inventoryDefinition[connector._name]), async currencyCode => {
                const balanceInfo = await connector.getBalance(currencyCode);
                if (!balanceInfo?.success) return false;

                return balanceInfo.available >= this._inventoryDefinition[connector._name][currencyCode];
            })).every(val => val);
        })).every(val => val));
    }

    constructor(connectors, args) {
        super(connectors, args);
        this._maxInvPct = args.maxInvPct;
        this._inventoryDefinition = args.inventoryDefinition;

        if (!args.maxInvPct || !args.inventoryDefinition) {
            Logger.error("FloatingArbitrage", "startup", "One or more required arguments not provided", this._socketBroadcaster);
            this._unfitToRun = true;
            return;
        }

        this._maxPriceDropPct = args.maxPriceDropPct ?? 5;
    }

    /**
     * Calculate the amount of coins that shifts the price by `this._maxPriceDropPct` % if all trades were to be executed
     * @param {BaseProvider} connector Connector for the exchange we're gathering depth from
     * @param {{ baseCurrency: string, referenceCurrency: string }} tradingPair Trading pair for which we're gathering depth for
     * @param {"bid" | "ask"} side Whether the depth is going to be calculated for the bid or ask side of the order books
     * @returns {Promise<number>} amount of coins that can be covered
     */
    async calculateDepth(connector, tradingPair, side) {
        const orderBook = await connector.getOrderBook(tradingPair.baseCurrency, tradingPair.referenceCurrency);
        
        const currentSideMarketPrice = orderBook[side][0].price;
        let amount = 0;

        for (const bookEntry of orderBook[side]) {
            if (
                ((bookEntry.price / currentSideMarketPrice) < (1 - this._maxPriceDropPct/100) && side === "bid") ||
                ((bookEntry.price / currentSideMarketPrice) > (1 + this._maxPriceDropPct/100) && side === "ask")
            ) return amount;

            amount += bookEntry.amount;
        }

        // fall-through in case the exchange is so illiquid or this._maxPriceDropPct is so unrealistic that we can trade out the entire order book side
        return amount;
    }
    }

    async start() {
        await this.fitToRun();
        Logger.success("FloatingArbitrage", "startup", "Startup complete and trading algorithm started!");
    }

    async tick() {
        // for right now the defined inventory is higher than available balance, but we want to re-check that
        if (this._unfitToRun) {
            Logger.warning("FloatingArbitrage", "fitToRunCheck", "The trading algorithm is unfit to run, likely due to available balance on at least one exchange being lower than the defined inventory", this._socketBroadcaster);
            await sleep(10000);
            await this.fitToRun();
            return;
        }
    }

    async shutdown() {
        //! enable this once algorithm is done
        // await promiseMap(this._connectors, async connector => await connector.cancelAllPending());
    }
}