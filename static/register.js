var previousValues = {};

function isValidNewExchangeNameOption(newName) {
    return !window.alreadySelected.includes(newName);
}

function createExchangeSelectOption(exchangeName) {
    const option = document.createElement("option");
    option.setAttribute(
        "value",
        `${window.possibleExchanges.indexOf(exchangeName)}`
    );
    option.innerText = exchangeName;

    return option;
}

function regenerateDropdowns() {
    const div = document.createElement("div");
    const credentialInputRows = document.getElementById("credentialInputRows");

    for (let i = 0; i < credentialInputRows.children.length; i++) {
        const targettedSelect = credentialInputRows.children.item(i).children.item(0);
        const selectedExchangeName = window.possibleExchanges[parseInt(targettedSelect.value)];

        for (const exchangeName of window.alreadySelected) {
            const select = document.createElement("select");
            select.setAttribute("id", targettedSelect.getAttribute("id"));
            select.value = targettedSelect.value;
            select.addEventListener("change", processExchangeNameChange);

            select.appendChild(createExchangeSelectOption(selectedExchangeName));

            for (const applicableExchangeName of window.possibleExchanges.filter(x => (!window.alreadySelected.includes(x) || x === exchangeName) && x !== selectedExchangeName)) {
                select.appendChild(createExchangeSelectOption(applicableExchangeName));
            }

            targettedSelect.replaceWith(select);
        }
    }
}

function processExchangeNameChange(event) {
    const selectId = event.target.id;
    const currentValue = possibleExchanges[event.target.value];

    if (!isValidNewExchangeNameOption(currentValue)) {
        event.target.value = `${possibleExchanges.indexOf(
            previousValues[selectId]
        )}`;
        alert(
            "This exchange is already in the list. Update its credentials instead."
        );
        return;
    }

    alreadySelected = alreadySelected.filter(
        (x) => x !== previousValues[selectId]
    );
    alreadySelected.push(currentValue);
    previousValues[selectId] = currentValue;

    regenerateDropdowns();
}

function addExchangeSelector() {
    let foundFirstElement = false;

    const div = document.createElement("div");
    div.setAttribute(
        "id",
        `exchangeEntry_${window.alreadySelected.length}`
    );

    const select = document.createElement("select");
    const selectId = `exchangeSelectOption_${window.alreadySelected.length}`;
    select.setAttribute("id", selectId);
    select.addEventListener("change", processExchangeNameChange);

    for (const exchangeName of window.possibleExchanges) {
        if (window.alreadySelected.includes(exchangeName)) continue;

        if (!foundFirstElement) {
            foundFirstElement = true;
            window.alreadySelected.push(exchangeName);
        }

        const option = document.createElement("option");
        option.setAttribute(
            "value",
            `${window.possibleExchanges.indexOf(exchangeName)}`
        );
        option.innerText = exchangeName;

        select.appendChild(option);
    }
    if (!foundFirstElement) return;

    div.appendChild(select);

    window.previousValues[selectId] = select.children.item(0).innerText;

    const apiKeyInput = document.createElement("input");
    apiKeyInput.setAttribute("type", "password");
    apiKeyInput.setAttribute("placeholder", "api key");
    div.appendChild(apiKeyInput);

    const apiSecretInput = document.createElement("input");
    apiSecretInput.setAttribute("type", "password");
    apiSecretInput.setAttribute("placeholder", "api secret");
    div.appendChild(apiSecretInput);

    document.getElementById("credentialInputRows").appendChild(div);

    regenerateDropdowns();
}

function deleteExchangeSelector() {
    const el = document.getElementById("credentialInputRows");
    if (el.children.length < 2) {
        alert("No more entries to delete");
        return;
    }

    const child = el.children.item(el.children.length - 1);
    window.alreadySelected = window.alreadySelected.filter(x => x !== window.possibleExchanges[child.children.item(0).value]);
    child.remove();

    regenerateDropdowns();
}

async function register() {
    const username = document.getElementById("usernameInput").value;
    const password = document.getElementById("passwordInput").value;
    if (username === "" || password === "") {
        alert("Please input both your username and password");
        return;
    }

    let apiCreds = {};
    const credentialInputRows = document.getElementById("credentialInputRows");
    for (let i = 0; i < credentialInputRows.children.length; i ++) {
        const entry = credentialInputRows.children.item(i);

        const select = entry.children.item(0);
        const apiKey = entry.children.item(1).value;
        const apiSecret = entry.children.item(2).value;

        if (apiKey === "" || apiSecret === "") {
            alert("Please fill in all blank entries.");
            return;
        }

        apiCreds[window.possibleExchanges[parseInt(select.value)].toLowerCase().replace("-", "")] = { key: apiKey, secret: apiSecret };
    }
    const response = await (await fetch("/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: username,
            password: password,
            exchangeCredentials: apiCreds
        })
    })).json();

    if (!response.success) {
        console.log(response);
        alert(`Failed to register:\n\n${response.error}`);
        return;
    }

    alert("Registered Successfully!");
    window.location.href = "/";
}

// NOTE: these get stored in the `window` object
// hence why they're declared using `var` and not `const`
var possibleExchanges = [
    "TradeOgre",
    "CoinEx",
    "Dex-Trade",
    "Graviex",
    "TxBit",
    "Catex",
    "AAX",
    "P2B",
    "Exbitron",
    "SouthXChange",
    "Xeggex",
];
var alreadySelected = [];

window.onload = function () {
    addExchangeSelector();
};