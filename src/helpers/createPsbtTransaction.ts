import {HDSegwitBech32Wallet} from "~src/class";

export default async (wallet: HDSegwitBech32Wallet, targets: any) => {
    const changeAddress = await wallet.getChangeAddressAsync();
    const requestedSatPerByte = 10500;
    let lutxo = wallet.getUtxo();

    return wallet.createTransaction(
        lutxo,
        targets,
        requestedSatPerByte,
        changeAddress,
        HDSegwitBech32Wallet.finalRBFSequence,
    );
};
