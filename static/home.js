function logout() {
  localStorage.clear(), (window.location.href = "/");
}

var pendingTradeUpdateInterval;

function generateTradeRows(trades) {
  const rows = [];
  for (const trade of trades) {
    const row = document.createElement("tr");

    const price = document.createElement("td");
    const amount = document.createElement("td");
    const tradingPair = document.createElement("td");

    price.append(document.createElement("p").append(document.createTextNode(trade.price)));
    amount.append(document.createElement("p").append(document.createTextNode(trade.amount)));
    tradingPair.append(document.createElement("p").append(document.createTextNode(`${trade.baseCurrency}-${trade.baseCurrency}`)));

    row.append(price, amount, tradingPair);
    rows.push(row);
  }

  return rows;
}

async function updatePendingTradesWindow() {
  const username = localStorage.getItem("username");
  const password = document.getElementById("passwordInput").value;
  const strategy = document.getElementById("strategy").value

  if (!username || !password || !strategy) {
    alert("Information you have entered on this page seems to be invalid. Did you delete anything by mistake?");
    return;
  }

  const pendingTrades = await fetch(`/pendingExchangeOrders?username=${username}&password=${password}&strategy=${strategy}`);

  if (pendingTrades.status !== 200) {
    alert(`Failed to get pending trades: HTTP ${pendingTrades.status}`);
    return;
  }

  const pendingTradesJson = await pendingTrades.json();

  const coinex = document.getElementById("coinex");
  const dextrade = document.getElementById("dextrade");
  const nonkyc = document.getElementById("nonkyc");
  const tradeogre = document.getElementById("tradeogre");
  const xeggex = document.getElementById("xeggex");

  coinex.replaceChildren(...generateTradeRows(pendingTradesJson.CoinEx));
  dextrade.replaceChildren(...generateTradeRows(pendingTradesJson.DexTrade));
  nonkyc.replaceChildren(...generateTradeRows(pendingTradesJson.NonKYC));
  tradeogre.replaceChildren(...generateTradeRows(pendingTradesJson.TradeOgre));
  xeggex.replaceChildren(...generateTradeRows(pendingTradesJson.Xeggex));
}

async function startTrading() {
  const t = document.getElementById("tradingButton"),
    e = localStorage.getItem("username"),
    a = document.getElementById("passwordInput").value,
    r = document.getElementById("strategyArgs").value,
    s = document.getElementById("strategy").value;

  window.ioSocket.emit("login as", `${e},${s}`)
  if (
      (t.setAttribute("disabled", !0),
      t.setAttribute("value", "Loading..."),
      !a || !s)
  ) {
      alert("Please confirm your password and try again"),
          t.removeAttribute("disabled"),
          t.setAttribute("value", "Start Trading");
      return;
  }
  if ("" !== r)
      try {
          JSON.parse(r);
      } catch (n) {
          alert("Strategy arguments not in JSON format"),
              t.removeAttribute("disabled"),
              t.setAttribute("value", "Start Trading");
          return;
      }
  else r = null;
  let i = await (
      await fetch(
          `/startTrading?username=${e}&password=${a}&strategy=${s}${
              r ? `&args=${r}` : ""
          }`,
          { method: "POST" },
      )
  ).json();
  t.removeAttribute("disabled");
  t.setAttribute("value", i.success ? "Stop Trading" : "Start Trading");

  if (i.success) {
    t.setAttribute("onclick", "stopTrading()");
    pendingTradeUpdateInterval = setInterval(updatePendingTradesWindow, 15000);
  } else {
    alert(`Failed to start trading: ${i.error}`);
  }
}
async function stopTrading() {
  const t = document.getElementById("tradingButton"),
      e = localStorage.getItem("username"),
      a = document.getElementById("passwordInput").value,
      strategy = document.getElementById("strategy").value
  if (
      (t.setAttribute("disabled", !0),
      t.setAttribute("value", "Loading..."),
      !a)
  ) {
      alert("Please confirm your password and try again");
      return;
  }
  const r = await (
      await fetch(`/stopTrading?username=${e}&password=${a}&strategy=${strategy}`, {
          method: "POST",
      })
  ).json();
  if (pendingTradeUpdateInterval) clearInterval(pendingTradeUpdateInterval);
  window.ioSocket.close(),
      t.setAttribute("value", "Start Trading"),
      t.setAttribute("onclick", "startTrading()"),
      t.removeAttribute("disabled"),
      r.success ||
          alert(`Failed to stop trading:

${r.error}`);
}
function clearServerMessages() {
  document.getElementById("serverMessagesDisplay").textContent = "";
}
window.onload = async function () {
  window.ioSocket = io();
  window.ioSocket.on("message", (t) => {
    const e = document.getElementById("serverMessagesDisplay");
    (e.textContent += `${t}\n\n`), (e.scrollTop = e.scrollHeight);
  });

  const username = localStorage.getItem("username");
  username || (window.location.href = "/login.html"),
    (document.getElementById("usernameDisplay").innerHTML = `<strong>${username}</strong>`)
};
