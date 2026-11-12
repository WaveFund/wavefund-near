// Public-data-only verification; no keys or signing.
import {readTidepoolFundingProof} from '../runtime/tidepool/read-model.mjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
console.log(JSON.stringify(await readTidepoolFundingProof(JSON.parse(text)),null,2));
