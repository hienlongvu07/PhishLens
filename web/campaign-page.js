import qrcode from "./vendor/qrcode.mjs";
import { recordEvent } from "./community-shared.js";
const url=location.href;recordEvent("campaign_view");
document.querySelectorAll("[data-event]").forEach(link=>link.addEventListener("click",()=>recordEvent(link.dataset.event)));
const qr=qrcode(0,"M");qr.addData(url,"Byte");qr.make();document.querySelector("#campaign-qr").innerHTML=qr.createSvgTag(5,3);
document.querySelector("#share-facebook").href=`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
async function clickShare(success){recordEvent("share_click");try{await success();recordEvent("share_success");document.querySelector("#share-status").textContent="Đã chia sẻ.";document.querySelector("#share-status").classList.add("success");}catch{document.querySelector("#share-status").textContent="Chưa chia sẻ được. Bạn có thể sao chép liên kết.";}}
document.querySelector("#share-native").addEventListener("click",()=>{if(navigator.share)clickShare(()=>navigator.share({title:"#DungClickVoi · PhishLens",text:"Dừng lại. Nhìn kỹ. Xác minh.",url}));else document.querySelector("#share-status").textContent="Trình duyệt chưa hỗ trợ chia sẻ. Hãy sao chép liên kết.";});
document.querySelector("#share-copy").addEventListener("click",()=>clickShare(async()=>{await navigator.clipboard.writeText(url);}));
document.querySelector("#share-facebook").addEventListener("click",()=>recordEvent("share_click"),{once:true});
