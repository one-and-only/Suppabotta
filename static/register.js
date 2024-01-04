var previousValues = {};

function isValidNewExchangeNameOption(e) {
    return !window.alreadySelected.includes(e)
}

function createExchangeSelectOption(e) {
    let t = document.createElement("option");
    return t.setAttribute("value", `${window.possibleExchanges.indexOf(e)}`), t.innerText = e, t
}

function regenerateDropdowns() {
    document.createElement("div");
    let e = document.getElementById("credentialInputRows");
    for (let t = 0; t < e.children.length; t++) {
        let n = e.children.item(t).children.item(0),
            l = window.possibleExchanges[parseInt(n.value)];
        for (let a of window.alreadySelected) {
            let r = document.createElement("select");
            for (let i of (r.setAttribute("id", n.getAttribute("id")), r.value = n.value, r.addEventListener("change", processExchangeNameChange), r.appendChild(createExchangeSelectOption(l)), window.possibleExchanges.filter(e => (!window.alreadySelected.includes(e) || e === a) && e !== l))) r.appendChild(createExchangeSelectOption(i));
            n.replaceWith(r)
        }
    }
}

function processExchangeNameChange(e) {
    let t = e.target.id,
        n = possibleExchanges[e.target.value];
    if (!isValidNewExchangeNameOption(n)) {
        e.target.value = `${possibleExchanges.indexOf(previousValues[t])}`, alert("This exchange is already in the list. Update its credentials instead.");
        return
    }(alreadySelected = alreadySelected.filter(e => e !== previousValues[t])).push(n), previousValues[t] = n, regenerateDropdowns()
}

function addExchangeSelector() {
    let e = !1,
        t = document.createElement("div");
    t.setAttribute("id", `exchangeEntry_${window.alreadySelected.length}`);
    let n = document.createElement("select"),
        l = `exchangeSelectOption_${window.alreadySelected.length}`;
    for (let a of (n.setAttribute("id", l), n.addEventListener("change", processExchangeNameChange), window.possibleExchanges)) {
        if (window.alreadySelected.includes(a)) continue;
        e || (e = !0, window.alreadySelected.push(a));
        let r = document.createElement("option");
        r.setAttribute("value", `${window.possibleExchanges.indexOf(a)}`), r.innerText = a, n.appendChild(r)
    }
    if (!e) return;
    t.appendChild(n), window.previousValues[l] = n.children.item(0).innerText;
    let i = document.createElement("input");
    i.setAttribute("type", "password"), i.setAttribute("placeholder", "api key"), t.appendChild(i);
    let s = document.createElement("input");
    s.setAttribute("type", "password"), s.setAttribute("placeholder", "api secret"), t.appendChild(s), document.getElementById("credentialInputRows").appendChild(t), regenerateDropdowns()
}

function deleteExchangeSelector() {
    let e = document.getElementById("credentialInputRows");
    if (e.children.length < 2) {
        alert("No more entries to delete");
        return
    }
    let t = e.children.item(e.children.length - 1);
    window.alreadySelected = window.alreadySelected.filter(e => e !== window.possibleExchanges[t.children.item(0).value]), t.remove(), regenerateDropdowns()
}
async function register() {
    let e = document.getElementById("usernameInput").value,
        t = document.getElementById("passwordInput").value;
    if ("" === e || "" === t) {
        alert("Please input both your username and password");
        return
    }
    let n = {},
        l = document.getElementById("credentialInputRows");
    for (let a = 0; a < l.children.length; a++) {
        let r = l.children.item(a),
            i = r.children.item(0),
            s = r.children.item(1).value,
            d = r.children.item(2).value;
        if ("" === s || "" === d) {
            alert("Please fill in all blank entries.");
            return
        }
        n[window.possibleExchanges[parseInt(i.value)].toLowerCase().replace("-", "")] = {
            key: s,
            secret: d
        }
    }
    let c = await (await fetch("/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: e,
            password: t,
            exchangeCredentials: n
        })
    })).json();
    if (!c.success) {
        console.log(c), alert(`Failed to register: ${c.error}`);
        return
    }
    alert("Registered Successfully!"), window.location.href = "/"
}
var possibleExchanges = ["TradeOgre", "CoinEx", "Dex-Trade", "Xeggex", "NonKYC", "SafeTrade"],
    alreadySelected = [];
window.onload = function() {
    addExchangeSelector()
};