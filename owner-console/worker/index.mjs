import release from '../generated/release.mjs';
import {createHouseholdsClass} from './households.mjs';
import {createRouter} from './router.mjs';
export const Households=createHouseholdsClass(release);
export default createRouter();
