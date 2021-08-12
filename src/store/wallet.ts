/*import {HDSegwitBech32WalletWS} from "~src/class";

const hd = new HDSegwitBech32WalletWS()
hd.fromJson(localStorage.wallet || "{}", hd);
hd.addTransactionListener();

const getOrGenerateSeed = async () => {
    let { secret } = localStorage;
    if (hd.getSecret() === secret) return;
    if (secret !== undefined && (secret.split(' ').length === 12 || secret.split(' ').length === 24)) {
        hd.setSecret(secret);
        if (hd.validateMnemonic()) {
            return;
        }
    }
    await hd.generate();
    if (hd.validateMnemonic()) {
        localStorage.secret = hd.getSecret();
    }
}

getOrGenerateSeed();

export default hd;
*/
