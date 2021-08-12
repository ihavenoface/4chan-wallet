import { Metadata } from "userscript-metadata";
import {
    BuildConfig,
} from "userscripter/build";

import U from "./src/userscript";

export default function(_: BuildConfig): Metadata {
    return {
        name: U.name,
        version: U.version,
        description: U.description,
        author: U.author,
        grant: U.grant,
        match: U.match,
        namespace: U.namespace,
        run_at: U.runAt,
        inject_into: U.injectInto,
        updateURL: U.updateURL,
        downloadURL: U.downloadURL,
    };
}
