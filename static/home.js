function logout() {
    localStorage.clear();
    window.location.href = "/";
}

window.onload = async function () {
    const username = localStorage.getItem("username");

    if (!username) window.location.href = "/login.html";

    document.getElementById("usernameDisplay").innerHTML = `<strong>${username}</strong>`
};

async function startTrading() {
    const tradingButton = document.getElementById("tradingButton");
    const username = localStorage.getItem("username");
    const password = document.getElementById("passwordInput").value;
    let strategyArgs = document.getElementById("strategyArgs").value;
    const strategy = document.getElementById("strategy").value;

    tradingButton.setAttribute("disabled", true);
    tradingButton.setAttribute("value", "Loading...");

    if (!password || !strategy) {
        alert("Please confirm your password and try again");
        return;
    }

    if (strategyArgs !== "") {
        try {
            JSON.parse(strategyArgs);
        } catch (e) {
            alert("Strategy arguments not in JSON format");
            return;
        }
    } else {
        strategyArgs = null;
    }

    // console.log(`/startTrading?username=${username}&password=${password}&strategy=${strategy}${strategyArgs ? `&args=${strategyArgs}` : ""}`);
    const response = await (await fetch(
        `/startTrading?username=${username}&password=${password}&strategy=${strategy}${strategyArgs ? `&args=${strategyArgs}` : ""}`,
        {
            method: "POST"
        }
    )).json();

    tradingButton.removeAttribute("disabled");
    tradingButton.setAttribute("value", response.success ? "Stop Trading" : "Start Trading");
    if (!response.success) {
        alert(`Failed to start trading:\n\n${response.error}`);
    } else {
        tradingButton.setAttribute("onclick", "stopTrading()");
    }
}

async function stopTrading() {
    const tradingButton = document.getElementById("tradingButton");
    const username = localStorage.getItem("username");
    const password = document.getElementById("passwordInput").value;

    tradingButton.setAttribute("disabled", true);
    tradingButton.setAttribute("value", "Loading...");

    if (!password) {
        alert("Please confirm your password and try again");
        return;
    }

    const response = await (await fetch(
        `/stopTrading?username=${username}&password=${password}`,
        {
            method: "POST"
        }
    )).json();

    tradingButton.setAttribute("value", "Start Trading");
    tradingButton.setAttribute("onclick", "startTrading()");
    tradingButton.removeAttribute("disabled");
    if (!response.success) {
        alert(`Failed to stop trading:\n\n${response.error}`);
    }
}