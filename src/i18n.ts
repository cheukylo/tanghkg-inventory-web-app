import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const resources = {
  en: {
    translation: {
      app_title: "Inventory Manager",
      online: "Online",
      offline: "Offline",
      sign_in: "Sign in",
      email: "Email",
      password: "Password",
      continue: "Continue",
      lookup_view_product: "Lookup (view product)",
      inventory_movements: "Inventory Movements (adjust counts)",
      manual_lookup: "Manual lookup",
      camera_scan: "Camera scan",
      receive: "Receive",
      send: "Send",
      transfer: "Transfer",
      adjust: "Adjust",
      confirm_receive: "Confirm receive",
      confirm_send: "Confirm send",
      confirm_move: "Confirm move",
      confirm_change: "Confirm change",
      no_stock_any_location: "No stock recorded in any location.",
      available_by_location: "Available by location",
      location: "Location",
      recent_activities: "Recent activity",
      availability: "Availability",
      qty: "Quantity",
      to_location: "To location",
      // add more as you go
    },
  },
  "zh-CN": {
    translation: {
      app_title: "库存管理",
      online: "在线",
      offline: "离线",
      sign_in: "登录",
      email: "邮箱",
      password: "密码",
      continue: "继续",
      lookup_view_product: "查询（查看产品）",
      inventory_movements: "库存操作（调整数量）",
      manual_lookup: "手动查询",
      camera_scan: "相机扫码",
      receive: "入库",
      send: "出库",
      transfer: "调拨",
      adjust: "调整",
      confirm_receive: "确认入库",
      confirm_send: "确认出库",
      confirm_move: "确认调拨",
      confirm_change: "确认更改",
      no_stock_any_location: "所有库位都没有库存记录。",
      available_by_location: "各库位库存",
      location: "位置",
      recent_activities: "最近记录",
      availability: "有货",
      qty: "数量",
      to_location: "入库位置"
      // add more as you go
    },
  },
};

i18n
  .use(LanguageDetector) // auto-detect browser language
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
