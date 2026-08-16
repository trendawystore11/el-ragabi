/**
 * Customer rules & constants — pure domain layer.
 * التصنيفات تُقرأ من ملف التخصيص المركزي (src/client/config.js).
 */
import { CLIENT } from '../../client/config.js'

export const CUSTOMER_CATEGORIES = CLIENT.customerCategories;

export const DEFAULT_CUSTOMER_CATEGORY = CLIENT.defaultCustomerCategory;
