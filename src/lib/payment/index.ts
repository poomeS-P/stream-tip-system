import type { IPaymentProvider } from "@/types";
import { StripeProvider } from "./stripe-provider";

// Factory สำหรับเลือก Payment Provider
// เพิ่ม Provider อื่น เช่น Omise/Opn Payments ได้ในอนาคตโดยไม่ต้องแก้ Business Logic
let _provider: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (_provider) return _provider;

  const providerName = process.env.PAYMENT_PROVIDER ?? "stripe";

  switch (providerName) {
    case "stripe":
      _provider = new StripeProvider();
      break;
    // case "omise":
    //   _provider = new OmiseProvider();
    //   break;
    default:
      throw new Error(`Unknown payment provider: "${providerName}". Set PAYMENT_PROVIDER in .env`);
  }

  return _provider;
}
