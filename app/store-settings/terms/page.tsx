"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";

// --- Icons ---
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);
const ChevronRightSmallIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" style={{ width: 16, height: 16 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 18, height: 18 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);
const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 14, height: 14 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

// --- Terms Data ---
interface TermItem {
  id: string;
  brand: string;
  category: string;
  title: string;
  content: string;
  pdfUrl: string;
}

function generateId(brand: string, category: string, title: string) {
  return `${brand}__${category}__${title}`;
}

// Strip full-width parentheses suffix to get base category name
// e.g. "KIOSK（桃）" → "KIOSK", "KIOSK（ワイド）" → "KIOSK"
// But keep half-width ones like "KIOSK(QRコード読み取り)" as-is
function getBaseCategory(category: string): string {
  return category.replace(/（[^）]*）$/, "").trim();
}

// Extract variant label from category (the part in full-width parens)
function getVariantLabel(category: string): string {
  const match = category.match(/（([^）]*)）$/);
  return match ? match[1] : "";
}

const INITIAL_TERMS: TermItem[] = [
  // FIT365
  { brand: "FIT365", category: "Web/APP入会", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "あんしんサポート利用規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "Web/APP入会（法人）", title: "債務不履行の同意", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "デジタルチケット都度利用", title: "オプション都度利用規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "APP 同伴（同伴入退館）", title: "同伴者利用の規約確認", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "退会手続き", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（桃）", title: "債務不履行の同意", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK", title: "休会制度規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK", title: "休会制度についてのご案内", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK", title: "契約区分変更規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "退会手続き", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "債務不履行の同意", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "休会制度規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（ワイド）", title: "休会制度についてのご案内", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "退会手続き", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK（黄）", title: "債務不履行の同意", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "1DayPass", title: "１Day Pass利用規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "主契約変更手続き", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "退会手続き", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "休会制度規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "各種お手続き", title: "休会制度についてのご案内", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "ご利用規約及び誓約書(契約別①)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "ご利用規約及び誓約書(契約別②)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "ご利用規約及び誓約書(契約別③)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "ご利用規約及び誓約書(契約別④)", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "KIOSK(QRコード読み取り)", title: "ご入会にあっての注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "MineFit向け1DayPass", title: "ストア利用の注意事項", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "レズミルズ契約（オプション）", title: "契約規約", content: "", pdfUrl: "" },
  { brand: "FIT365", category: "レズミルズ解約（オプション）", title: "解約規約", content: "", pdfUrl: "" },
  // JOYFIT
  { brand: "JOYFIT", category: "Web入会", title: "スポーツクラブJOYFITご利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "スポーツクラブJOYFIT個人情報取り扱いについて", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "JOYFITあんしんサポートについて", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "ご利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "特定商取引法に基づく表示", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "クレジットカードで簡単入会にて手続きのできる方、入会資格について(赤)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "クレジットカードで簡単入会にて手続きのできる方、入会資格について(YOGA)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "クレジットカードで簡単入会にて手続きのできる方、入会資格について(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "クレジットカードで簡単入会にて手続きのできる方、入会資格について(EMS)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "どこでもJOY同意書(赤)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "どこでもJOY同意書(YOGA)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "どこでもJOY同意書(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "どこでもJOY同意書(EMS)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "申し込み内容のご確認(赤)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "申し込み内容のご確認(YOGA)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "申し込み内容のご確認(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web入会", title: "申し込み内容のご確認(EMS)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご利用時のお願い(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "入会資格(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "JOYFIT安心サポートについて(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "どこでもJOYについて(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "プライバシーポリシー(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK入会", title: "ご入会にあたっての注意事項(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK休会", title: "休会申請はこちらから", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "Web休会", title: "休会のご案内", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(赤①)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(赤②)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(赤Wide)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(赤Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(緑<yoga>)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(青Size)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "KIOSK退会", title: "退会申請はこちらから(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "OneTimePass", title: "利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "外部販売サイト WellnessPass(法人1DayPass)", title: "ご利用に際しての規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "いっしょにJOY", title: "注意事項(赤)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "いっしょにJOY", title: "注意事項(青)", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "オンラインライブレッスン契約", title: "オンラインレッスン利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "オンラインライブレッスン解約", title: "オンラインレッスン利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "あすけんオンラインライブレッスン契約", title: "あすけんオンラインレッスン利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "MineFit向け1DayPass", title: "利用規約", content: "", pdfUrl: "" },
  { brand: "JOYFIT", category: "レッスン（ヨガWEB予約）", title: "スタジオプログラムご予約のお客様へ", content: "", pdfUrl: "" },
  // WellnessFrontier
  { brand: "WellnessFrontier", category: "Web入会", title: "ご入会される皆様へ", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "個人情報取り扱いについて（プライバシーポリシー）", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "入会資格", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "ご利用時のお願い", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "JOYFITあんしんサポートについて", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "営業システム・誓約書・休会制度規約", content: "", pdfUrl: "" },
  { brand: "WellnessFrontier", category: "Web入会", title: "法人会員における入会に関する注意事項", content: "", pdfUrl: "" },
  // エコジョイ
  { brand: "エコジョイ", category: "App入会", title: "ご入会される皆様へ", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "入会資格", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "ご利用時のお願い", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "フリーウェイト・カーディオ機器使用に関しての注意事項", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "どこでもJOY同意書", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App入会", title: "営業システム・誓約書・休会制度規約", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "あんしんサポートの解約に関するご注意", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "退会手続き", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "主契約変更手続き", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "ご入会される皆様へ", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "プライバシーポリシー", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "ご入会にあたっての注意事項", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "入会資格", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "ご利用時のお願い", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "フリーウェイト・カーディオ機器使用に関しての注意事項", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "どこでもJOY同意書", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "あんしんサポート会員規約", content: "", pdfUrl: "" },
  { brand: "エコジョイ", category: "App各種お手続き", title: "営業システム・誓約書・休会制度規約", content: "", pdfUrl: "" },
].map((t) => ({ ...t, id: generateId(t.brand, t.category, t.title) }));

// Brand config
const BRAND_CONFIG: Record<string, { color: string; bg: string }> = {
  FIT365: { color: "#ea580c", bg: "#fff7ed" },
  JOYFIT: { color: "#dc2626", bg: "#fef2f2" },
  WellnessFrontier: { color: "#7c3aed", bg: "#f5f3ff" },
  "エコジョイ": { color: "#059669", bg: "#ecfdf5" },
};

const BRANDS = ["FIT365", "JOYFIT", "WellnessFrontier", "エコジョイ"];

// Group terms by brand -> baseCategory (merging variants)
function groupTerms(data: TermItem[], search: string) {
  const filtered = search
    ? data.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.category.toLowerCase().includes(search.toLowerCase()) ||
          t.brand.toLowerCase().includes(search.toLowerCase())
      )
    : data;

  const grouped: Record<string, Record<string, TermItem[]>> = {};
  for (const item of filtered) {
    const baseCategory = getBaseCategory(item.category);
    if (!grouped[item.brand]) grouped[item.brand] = {};
    if (!grouped[item.brand][baseCategory]) grouped[item.brand][baseCategory] = [];
    grouped[item.brand][baseCategory].push(item);
  }
  return grouped;
}

export default function TermsManagementPage() {
  const [terms, setTerms] = useState<TermItem[]>(INITIAL_TERMS);
  const [filterBrand, setFilterBrand] = useState("ALL");
  const [search, setSearch] = useState("");
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>(
    Object.fromEntries(BRANDS.map((b) => [b, true]))
  );
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  // Editor state
  const [editingTerm, setEditingTerm] = useState<TermItem | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorTab, setEditorTab] = useState<"edit" | "preview" | "html">("edit");
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const toggleBrand = (brand: string) => {
    setExpandedBrands((prev) => ({ ...prev, [brand]: !prev[brand] }));
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Open editor
  const openEditor = (term: TermItem) => {
    setEditingTerm(term);
    setEditorContent(term.content);
    setPdfUrl(term.pdfUrl);
    setEditorTab("edit");
  };

  // Save content
  const handleSave = () => {
    if (!editingTerm) return;
    setTerms((prev) =>
      prev.map((t) =>
        t.id === editingTerm.id ? { ...t, content: editorContent, pdfUrl } : t
      )
    );
    showToast("保存しました");
  };

  // Export as HTML file
  const exportHtml = () => {
    if (!editingTerm) return;
    const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${editingTerm.title}</title>
  <style>
    body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; font-size: 14px; line-height: 1.8; color: #333; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 24px; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>${editingTerm.title}</h1>
  ${editorContent}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${editingTerm.title}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("HTMLファイルをダウンロードしました");
  };

  // Generate PDF
  const generatePdf = async () => {
    if (!editingTerm || !editorContent) {
      showToast("コンテンツを入力してください", "error");
      return;
    }
    setPdfGenerating(true);
    try {
      const res = await fetch("/api/store-settings/terms/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: editorContent, title: editingTerm.title }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "PDF生成に失敗しました");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${editingTerm.title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("PDFをダウンロードしました");
    } catch (err: any) {
      showToast(err.message || "PDF生成エラー", "error");
    } finally {
      setPdfGenerating(false);
    }
  };

  // Generate PDF URL
  const generatePdfUrl = async () => {
    if (!editingTerm || !editorContent) {
      showToast("コンテンツを入力してください", "error");
      return;
    }
    setPdfGenerating(true);
    try {
      const res = await fetch("/api/store-settings/terms/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: editorContent, title: editingTerm.title }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "PDF生成に失敗しました");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setTerms((prev) =>
        prev.map((t) => (t.id === editingTerm.id ? { ...t, pdfUrl: url } : t))
      );
      showToast("PDF URLを生成しました");
    } catch (err: any) {
      showToast(err.message || "PDF URL生成エラー", "error");
    } finally {
      setPdfGenerating(false);
    }
  };

  const copyPdfUrl = () => {
    if (pdfUrl) {
      navigator.clipboard.writeText(pdfUrl);
      showToast("URLをコピーしました");
    }
  };

  // Insert HTML helpers
  const insertTag = (tag: string, wrap?: boolean) => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editorContent.substring(start, end);

    let insertion: string;
    if (wrap && selected) {
      insertion = `<${tag}>${selected}</${tag}>`;
    } else {
      insertion = `<${tag}></${tag}>`;
    }

    const newContent = editorContent.substring(0, start) + insertion + editorContent.substring(end);
    setEditorContent(newContent);
    setTimeout(() => {
      textarea.focus();
      const cursorPos = wrap && selected ? start + insertion.length : start + tag.length + 2;
      textarea.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  };

  // Data for list view
  const dataToShow = filterBrand === "ALL" ? terms : terms.filter((t) => t.brand === filterBrand);
  const grouped = groupTerms(dataToShow, search);

  const totalCount = dataToShow.filter((t) =>
    search
      ? t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase()) ||
        t.brand.toLowerCase().includes(search.toLowerCase())
      : true
  ).length;

  // --- EDITOR VIEW ---
  if (editingTerm) {
    const brandConf = BRAND_CONFIG[editingTerm.brand] || { color: "#64748b", bg: "#f1f5f9" };
    const variant = getVariantLabel(editingTerm.category);

    return (
      <div className="kb-store-root">
        <div className="kb-topbar">
          <div className="kb-topbar-inner">
            <button className="kb-back-link" onClick={() => setEditingTerm(null)}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ChevronLeftIcon /> 一覧へ戻る
              </span>
            </button>
            <div style={{ fontWeight: 700 }}>規約編集</div>
            <div style={{ width: 100 }} />
          </div>
        </div>

        <main className="kb-main-container kb-editor-main">
          {/* Header */}
          <div className="kb-editor-header">
            <div className="kb-editor-header-meta">
              <span className="kb-brand-badge" style={{ backgroundColor: brandConf.bg, color: brandConf.color }}>
                {editingTerm.brand}
              </span>
              <span className="kb-editor-category">
                {getBaseCategory(editingTerm.category)}
                {variant && <span className="kb-variant-tag">{variant}</span>}
              </span>
            </div>
            <h1 className="kb-editor-title">{editingTerm.title}</h1>
          </div>

          {/* Export Section - BEFORE Editor */}
          <div className="kb-export-section">
            <h3 className="kb-export-title">エクスポート・変換</h3>
            <div className="kb-export-grid">
              {/* HTML Export */}
              <div className="kb-export-card">
                <div className="kb-export-card-header">
                  <div className="kb-export-icon kb-export-icon-html">HTML</div>
                  <div>
                    <div className="kb-export-card-title">HTMLファイル出力</div>
                    <div className="kb-export-card-desc">スタイル付きHTMLとしてダウンロード</div>
                  </div>
                </div>
                <button className="kb-btn-export" onClick={exportHtml} disabled={!editorContent}>
                  HTMLダウンロード
                </button>
              </div>

              {/* PDF Export */}
              <div className="kb-export-card">
                <div className="kb-export-card-header">
                  <div className="kb-export-icon kb-export-icon-pdf">PDF</div>
                  <div>
                    <div className="kb-export-card-title">PDF出力</div>
                    <div className="kb-export-card-desc">A4形式のPDFとしてダウンロード</div>
                  </div>
                </div>
                <button
                  className="kb-btn-export"
                  onClick={generatePdf}
                  disabled={!editorContent || pdfGenerating}
                >
                  {pdfGenerating ? "生成中..." : "PDFダウンロード"}
                </button>
              </div>

              {/* PDF URL */}
              <div className="kb-export-card">
                <div className="kb-export-card-header">
                  <div className="kb-export-icon kb-export-icon-url">URL</div>
                  <div>
                    <div className="kb-export-card-title">PDF URL生成</div>
                    <div className="kb-export-card-desc">PDFを生成してURLを発行</div>
                  </div>
                </div>
                <button
                  className="kb-btn-export"
                  onClick={generatePdfUrl}
                  disabled={!editorContent || pdfGenerating}
                >
                  {pdfGenerating ? "生成中..." : "URL生成"}
                </button>
                {pdfUrl && (
                  <div className="kb-pdf-url-box">
                    <input type="text" readOnly value={pdfUrl} className="kb-pdf-url-input" />
                    <button className="kb-btn-copy" onClick={copyPdfUrl}>コピー</button>
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="kb-btn-open">開く</a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Editor Toolbar */}
          <div className="kb-editor-toolbar">
            <div className="kb-editor-tabs">
              <button
                className={`kb-editor-tab ${editorTab === "edit" ? "active" : ""}`}
                onClick={() => setEditorTab("edit")}
              >
                編集
              </button>
              <button
                className={`kb-editor-tab ${editorTab === "preview" ? "active" : ""}`}
                onClick={() => setEditorTab("preview")}
              >
                プレビュー
              </button>
              <button
                className={`kb-editor-tab ${editorTab === "html" ? "active" : ""}`}
                onClick={() => setEditorTab("html")}
              >
                HTMLソース
              </button>
            </div>
            <div className="kb-editor-actions-top">
              <button className="kb-btn-save" onClick={handleSave}>
                保存
              </button>
            </div>
          </div>

          {/* HTML Tag Helpers (edit mode only) */}
          {editorTab === "edit" && (
            <div className="kb-html-toolbar">
              <span className="kb-html-toolbar-label">挿入:</span>
              <button className="kb-tag-btn" onClick={() => insertTag("h1", true)}>H1</button>
              <button className="kb-tag-btn" onClick={() => insertTag("h2", true)}>H2</button>
              <button className="kb-tag-btn" onClick={() => insertTag("h3", true)}>H3</button>
              <button className="kb-tag-btn" onClick={() => insertTag("p", true)}>P</button>
              <button className="kb-tag-btn" onClick={() => insertTag("strong", true)}>B</button>
              <button className="kb-tag-btn" onClick={() => insertTag("em", true)}>I</button>
              <button className="kb-tag-btn" onClick={() => insertTag("ul")}>UL</button>
              <button className="kb-tag-btn" onClick={() => insertTag("ol")}>OL</button>
              <button className="kb-tag-btn" onClick={() => insertTag("li", true)}>LI</button>
              <button className="kb-tag-btn" onClick={() => insertTag("table")}>Table</button>
              <button className="kb-tag-btn" onClick={() => { setEditorContent(editorContent + "\n<br>\n"); }}>BR</button>
            </div>
          )}

          {/* Editor Content Area */}
          <div className="kb-editor-content">
            {editorTab === "edit" && (
              <textarea
                ref={editorRef}
                className="kb-editor-textarea"
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                placeholder={"<p>ここに規約の内容をHTMLで記述してください...</p>\n\n例:\n<h2>第1条（目的）</h2>\n<p>本規約は...</p>"}
              />
            )}
            {editorTab === "preview" && (
              <div className="kb-editor-preview">
                {editorContent ? (
                  <div dangerouslySetInnerHTML={{ __html: editorContent }} />
                ) : (
                  <p className="kb-preview-empty">コンテンツがありません。「編集」タブでHTMLを入力してください。</p>
                )}
              </div>
            )}
            {editorTab === "html" && (
              <div className="kb-editor-html-view">
                <pre><code>{editorContent || "(空)"}</code></pre>
              </div>
            )}
          </div>
        </main>

        {toast && (
          <div className={`kb-toast ${toast.type === "error" ? "kb-toast-error" : "kb-toast-success"}`}>
            {toast.message}
          </div>
        )}

        <style jsx global>{`${STYLES}`}</style>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <div className="kb-store-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/store-settings" className="kb-back-link">
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronLeftIcon /> 設定メニューへ戻る
            </span>
          </Link>
          <div style={{ fontWeight: 700 }}>規約・ポリシー管理</div>
          <div style={{ width: 100 }} />
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <h1>規約・ポリシー一覧</h1>
          <p>ブランド・カテゴリごとに規約を管理します。全 {terms.length} 件</p>
        </header>

        {/* Brand Filter Tabs */}
        <div className="kb-tabs">
          {[
            { key: "ALL", label: "すべて" },
            { key: "FIT365", label: "FIT365" },
            { key: "JOYFIT", label: "JOYFIT" },
            { key: "WellnessFrontier", label: "WellnessFrontier" },
            { key: "エコジョイ", label: "エコジョイ" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`kb-tab-item ${filterBrand === tab.key ? "active" : ""}`}
              onClick={() => setFilterBrand(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="kb-search-bar">
          <SearchIcon />
          <input
            type="text"
            placeholder="規約名・カテゴリで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="kb-search-input"
          />
          {search && (
            <button className="kb-search-clear" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
        </div>

        {totalCount > 0 && (
          <div className="kb-result-count">
            {search ? `検索結果: ${totalCount} 件` : `${totalCount} 件表示中`}
          </div>
        )}

        {/* Grouped Accordion */}
        <div className="kb-terms-list">
          {Object.entries(grouped).map(([brand, categories]) => {
            const brandConf = BRAND_CONFIG[brand] || { color: "#64748b", bg: "#f1f5f9" };
            const isBrandExpanded = expandedBrands[brand] !== false;
            const categoryCount = Object.keys(categories).length;
            const itemCount = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);

            return (
              <div key={brand} className="kb-brand-group">
                <button
                  className="kb-brand-header"
                  onClick={() => toggleBrand(brand)}
                  style={{ borderLeftColor: brandConf.color }}
                >
                  <div className="kb-brand-header-left">
                    <span className={`kb-chevron ${isBrandExpanded ? "expanded" : ""}`}>
                      <ChevronRightSmallIcon />
                    </span>
                    <span className="kb-brand-badge" style={{ backgroundColor: brandConf.bg, color: brandConf.color }}>
                      {brand}
                    </span>
                    <span className="kb-brand-meta">
                      {categoryCount} カテゴリ / {itemCount} 件
                    </span>
                  </div>
                </button>

                {isBrandExpanded && (
                  <div className="kb-categories">
                    {Object.entries(categories).map(([baseCategory, items]) => {
                      const catKey = `${brand}__${baseCategory}`;
                      const isCatExpanded = expandedCategories[catKey] !== false;

                      // Collect variant labels for this merged category
                      const variants = [...new Set(items.map((t) => getVariantLabel(t.category)).filter(Boolean))];

                      return (
                        <div key={catKey} className="kb-category-group">
                          <button className="kb-category-header" onClick={() => toggleCategory(catKey)}>
                            <div className="kb-category-header-left">
                              <span className={`kb-chevron ${isCatExpanded ? "expanded" : ""}`}>
                                <ChevronRightSmallIcon />
                              </span>
                              <span className="kb-category-name">{baseCategory}</span>
                              {variants.length > 0 && (
                                <span className="kb-variants-label">
                                  {variants.join(", ")}
                                </span>
                              )}
                              <span className="kb-category-count">{items.length}</span>
                            </div>
                          </button>

                          {isCatExpanded && (
                            <ul className="kb-term-items">
                              {items.map((term) => {
                                const v = getVariantLabel(term.category);
                                return (
                                  <li key={term.id} className="kb-term-item">
                                    <span className="kb-term-dot" style={{ backgroundColor: brandConf.color }} />
                                    {v && <span className="kb-term-variant-badge">{v}</span>}
                                    <span className="kb-term-title">{term.title}</span>
                                    {term.content && <span className="kb-term-has-content">編集済</span>}
                                    <button
                                      className="kb-term-edit-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditor(term);
                                      }}
                                    >
                                      <EditIcon /> 編集
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {totalCount === 0 && (
            <div className="kb-empty-state">該当する規約がありません</div>
          )}
        </div>
      </main>

      {toast && (
        <div className={`kb-toast ${toast.type === "error" ? "kb-toast-error" : "kb-toast-success"}`}>
          {toast.message}
        </div>
      )}

      <style jsx global>{`${STYLES}`}</style>
    </div>
  );
}

// --- Styles ---
const STYLES = `
  .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a; }
  .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
  .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
  .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; display: flex; align-items: center; transition: color 0.2s; background: none; border: none; cursor: pointer; }
  .kb-back-link:hover { color: #3b82f6; }
  .kb-main-container { max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
  .kb-editor-main { max-width: 1100px; }

  .kb-page-header { margin-bottom: 24px; }
  .kb-page-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; }
  .kb-page-header p { font-size: 14px; color: #64748b; margin: 0; }

  .kb-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
  .kb-tab-item { background: transparent; border: none; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; }
  .kb-tab-item:hover { color: #3b82f6; }
  .kb-tab-item.active { color: #3b82f6; border-bottom-color: #3b82f6; }

  .kb-search-bar { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 16px; margin-bottom: 12px; }
  .kb-search-input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; }
  .kb-search-clear { background: none; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 0 4px; }
  .kb-search-clear:hover { color: #64748b; }
  .kb-result-count { font-size: 13px; color: #64748b; margin-bottom: 16px; }

  .kb-terms-list { display: flex; flex-direction: column; gap: 12px; }
  .kb-brand-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }

  .kb-brand-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff; border: none; border-left: 4px solid; cursor: pointer; transition: background 0.15s; }
  .kb-brand-header:hover { background: #f8fafc; }
  .kb-brand-header-left { display: flex; align-items: center; gap: 12px; }

  .kb-brand-badge { padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 700; }
  .kb-brand-meta { font-size: 12px; color: #94a3b8; }

  .kb-chevron { display: flex; align-items: center; transition: transform 0.2s; color: #94a3b8; }
  .kb-chevron.expanded { transform: rotate(90deg); }

  .kb-categories { border-top: 1px solid #f1f5f9; }
  .kb-category-group { border-bottom: 1px solid #f8fafc; }
  .kb-category-group:last-child { border-bottom: none; }

  .kb-category-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 12px 20px 12px 40px; background: #fafbfc; border: none; cursor: pointer; transition: background 0.15s; }
  .kb-category-header:hover { background: #f1f5f9; }
  .kb-category-header-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .kb-category-name { font-size: 14px; font-weight: 600; color: #334155; }
  .kb-category-count { font-size: 11px; font-weight: 700; color: #94a3b8; background: #f1f5f9; padding: 2px 8px; border-radius: 99px; }
  .kb-variants-label { font-size: 11px; color: #8b5cf6; background: #f5f3ff; padding: 2px 8px; border-radius: 4px; font-weight: 500; }

  .kb-term-items { list-style: none; margin: 0; padding: 4px 20px 12px 64px; }
  .kb-term-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13px; color: #475569; }
  .kb-term-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .kb-term-title { line-height: 1.4; flex: 1; }
  .kb-term-variant-badge { font-size: 10px; color: #7c3aed; background: #ede9fe; padding: 2px 6px; border-radius: 4px; font-weight: 600; white-space: nowrap; }
  .kb-term-has-content { font-size: 11px; color: #10b981; background: #ecfdf5; padding: 2px 6px; border-radius: 4px; font-weight: 600; white-space: nowrap; }
  .kb-term-edit-btn { display: inline-flex; align-items: center; gap: 4px; background: none; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .kb-term-edit-btn:hover { background: #f1f5f9; border-color: #3b82f6; color: #3b82f6; }

  .kb-empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 14px; }

  /* Editor */
  .kb-editor-header { margin-bottom: 24px; }
  .kb-editor-header-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .kb-editor-category { font-size: 13px; color: #64748b; font-weight: 500; display: flex; align-items: center; gap: 8px; }
  .kb-editor-title { font-size: 22px; font-weight: 800; margin: 0; }
  .kb-variant-tag { font-size: 11px; color: #7c3aed; background: #ede9fe; padding: 2px 8px; border-radius: 4px; font-weight: 600; }

  /* Export Section */
  .kb-export-section { margin-bottom: 32px; }
  .kb-export-title { font-size: 16px; font-weight: 700; margin: 0 0 16px 0; }
  .kb-export-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .kb-export-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; }
  .kb-export-card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .kb-export-icon { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #fff; flex-shrink: 0; }
  .kb-export-icon-html { background: #f97316; }
  .kb-export-icon-pdf { background: #dc2626; }
  .kb-export-icon-url { background: #7c3aed; }
  .kb-export-card-title { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .kb-export-card-desc { font-size: 12px; color: #64748b; }
  .kb-btn-export { width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #334155; cursor: pointer; transition: all 0.15s; }
  .kb-btn-export:hover:not(:disabled) { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
  .kb-btn-export:disabled { opacity: 0.5; cursor: not-allowed; }

  .kb-pdf-url-box { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  .kb-pdf-url-input { flex: 1; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; background: #f8fafc; color: #475569; min-width: 0; }
  .kb-btn-copy, .kb-btn-open { background: none; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; text-decoration: none; white-space: nowrap; }
  .kb-btn-copy:hover, .kb-btn-open:hover { background: #f1f5f9; border-color: #94a3b8; }

  /* Editor Toolbar & Content */
  .kb-editor-toolbar { display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px 10px 0 0; padding: 8px 16px; }
  .kb-editor-tabs { display: flex; gap: 4px; }
  .kb-editor-tab { background: none; border: none; padding: 8px 16px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
  .kb-editor-tab:hover { background: #f1f5f9; }
  .kb-editor-tab.active { background: #eff6ff; color: #2563eb; }
  .kb-editor-actions-top { display: flex; gap: 8px; }
  .kb-btn-save { background: #3b82f6; color: #fff; border: none; padding: 8px 20px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .kb-btn-save:hover { background: #2563eb; }

  .kb-html-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: #f8fafc; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; flex-wrap: wrap; }
  .kb-html-toolbar-label { font-size: 11px; color: #94a3b8; font-weight: 600; margin-right: 4px; }
  .kb-tag-btn { background: #fff; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #475569; cursor: pointer; font-family: monospace; }
  .kb-tag-btn:hover { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }

  .kb-editor-content { border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; overflow: hidden; min-height: 400px; }
  .kb-editor-textarea { width: 100%; min-height: 400px; padding: 20px; border: none; outline: none; font-family: "SF Mono", "Fira Code", monospace; font-size: 13px; line-height: 1.7; resize: vertical; box-sizing: border-box; background: #fff; }
  .kb-editor-preview { padding: 24px; background: #fff; min-height: 400px; font-size: 14px; line-height: 1.8; }
  .kb-editor-preview h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  .kb-editor-preview h2 { font-size: 17px; margin-top: 20px; }
  .kb-editor-preview h3 { font-size: 15px; margin-top: 16px; }
  .kb-editor-preview p { margin: 8px 0; }
  .kb-editor-preview ul, .kb-editor-preview ol { padding-left: 24px; }
  .kb-editor-preview table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .kb-editor-preview th, .kb-editor-preview td { border: 1px solid #e2e8f0; padding: 8px; }
  .kb-editor-preview th { background: #f8fafc; }
  .kb-preview-empty { color: #94a3b8; font-style: italic; }
  .kb-editor-html-view { padding: 20px; background: #1e293b; min-height: 400px; overflow-x: auto; }
  .kb-editor-html-view pre { margin: 0; }
  .kb-editor-html-view code { color: #e2e8f0; font-size: 13px; line-height: 1.7; font-family: "SF Mono", "Fira Code", monospace; white-space: pre-wrap; word-break: break-all; }

  /* Toast */
  .kb-toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; z-index: 9999; animation: slideUp 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
  .kb-toast-success { background: #10b981; color: #fff; }
  .kb-toast-error { background: #ef4444; color: #fff; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;
