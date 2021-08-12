/*
import {WatchOnlyWalletWS} from "~src/class";

const watchOnlyWallets = new Map<string, WatchOnlyWalletWS>();

// todo: only load relevant keys (eg. this thread) here

const keys = JSON.parse(localStorage.watchonlykeys || "[]");

keys.forEach((key: string) => {
    const wallet = new WatchOnlyWalletWS();
    wallet.fromJson(localStorage[`watch-${key}`], wallet);
    // @ts-ignore
    if (+Date.now() - wallet._lastBalanceFetch >= 7 * 24 * 60 * 60 * 1000) {
        delete localStorage[`watch-${key}`];
        return;
    }
    watchOnlyWallets.set(key, wallet);
})

const saveWallets = () => {
    watchOnlyWallets.forEach((wallet) => {
        wallet.prepareForSerialization();
        localStorage[`watch-${wallet.getAddress()}`] = JSON.stringify(wallet);
    });
    localStorage.watchonlykeys = JSON.stringify([...watchOnlyWallets.keys()]);
}

const beforeUnloadListener = (event: BeforeUnloadEvent) => {
    saveWallets();
    return undefined;
};

addEventListener("beforeunload", beforeUnloadListener, {capture: true});

export default watchOnlyWallets;
*/
