import test from "node:test";
import assert from "node:assert/strict";
import { analyzeUrl } from "../src/analyzer.js";

test("HTTPS phổ biến không được gọi là an toàn và có lời giải thích giới hạn", () => {
  const result = analyzeUrl("https://example.com/about");
  assert.equal(result.level, "Chưa thấy dấu hiệu rõ");
  assert.equal(result.findings.length, 0);
  assert.equal(result.parts.protocol, "HTTPS");
  assert.match(result.parts.path, /about/);
});

test("HTTP được đánh dấu đáng ngờ và có hướng dẫn", () => {
  const result = analyzeUrl("http://example.com");
  assert.equal(result.level, "Có dấu hiệu đáng ngờ");
  assert.match(result.findings.join(" "), /HTTP/);
  assert.match(result.advice.join(" "), /OTP/);
});

test("dịch vụ rút gọn và thương hiệu gần giống được nhận diện", () => {
  assert.match(analyzeUrl("https://bit.ly/demo").findings.join(" "), /rút gọn|che khuất/);
  assert.match(analyzeUrl("https://paypa1.com").findings.join(" "), /paypal/);
});

test("danh sách đáng ngờ mẫu được nhận diện", () => {
  assert.match(analyzeUrl("https://login-verify-example.test").findings.join(" "), /danh sách đáng ngờ mẫu/);
});

test("URL sai định dạng và scheme không được hỗ trợ bị từ chối", () => {
  assert.equal(analyzeUrl("không phải URL").valid, false);
  assert.equal(analyzeUrl("file:///tmp/demo").valid, false);
});

test("nhiều cấp và ký tự Unicode tương đồng được giải thích", () => {
  assert.match(analyzeUrl("https://a.b.c.d.example.com").findings.join(" "), /cấp/);
  const unicode = analyzeUrl("https://раypal.com");
  assert.match(unicode.findings.join(" "), /Unicode|punycode/);
  assert.equal(unicode.level, "Có dấu hiệu đáng ngờ");
});

test("URL có tham số, cổng và fragment được tách thành phần", () => {
  const result = analyzeUrl("https://example.com:8443/path?q=demo#section");
  assert.equal(result.parts.port, "8443");
  assert.equal(result.parts.query, "q=demo");
  assert.equal(result.parts.fragment, "section");
});
