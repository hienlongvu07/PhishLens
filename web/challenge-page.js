import { challengeBank } from "./challenge-bank.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#challenge-form");
const status = (message, success = false) => {
  $("#challenge-status").textContent = message;
  $("#challenge-status").classList.toggle("success", success);
};
let questions = [];

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function renderQuestions() {
  questions = shuffled(challengeBank).slice(0, 10).map((question) => ({
    ...question,
    options: shuffled(question.options)
  }));
  const list = $("#question-list");
  list.replaceChildren();

  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";
    const title = document.createElement("h3");
    title.textContent = `${index + 1}. ${question.prompt}`;
    const category = document.createElement("p");
    category.className = "eyebrow";
    category.textContent = question.category;
    const options = document.createElement("div");
    options.className = "question-options";
    question.options.forEach((option) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = question.id;
      input.value = option.id;
      input.required = true;
      const text = document.createElement("span");
      text.textContent = option.text;
      label.append(input, text);
      options.append(label);
    });
    card.append(title, category, options);
    list.append(card);
  });

  $("#challenge-intro").classList.add("hidden");
  $("#challenge-result").classList.add("hidden");
  form.classList.remove("hidden");
  status("");
}

function renderResults(answers) {
  const correctCount = questions.reduce((count, question) =>
    count + Number(answers.get(question.id) === question.correctOptionId), 0);
  const root = $("#challenge-result");
  const heading = document.createElement("h2");
  heading.textContent = `${correctCount}/10 điểm`;
  const summary = document.createElement("p");
  summary.textContent = correctCount >= 9
    ? "Bạn đã nhận ra rất nhiều tín hiệu."
    : correctCount >= 6
      ? "Bạn có nền tảng tốt; hãy xem lại những điểm dễ bỏ sót."
      : "Hãy xem lời giải để biết cách kiểm tra an toàn hơn.";
  root.replaceChildren(heading, summary);

  questions.forEach((question, index) => {
    const selectedId = answers.get(question.id);
    const selected = question.options.find((option) => option.id === selectedId);
    const correct = question.options.find((option) => option.id === question.correctOptionId);
    const item = document.createElement("article");
    item.className = "review-item";
    const title = document.createElement("b");
    title.textContent = `${index + 1}. ${question.prompt}`;
    const verdict = document.createElement("p");
    verdict.className = selectedId === question.correctOptionId ? "correct" : "incorrect";
    verdict.textContent = selectedId === question.correctOptionId ? "Đúng" : "Chưa đúng";
    const selectedText = document.createElement("p");
    selectedText.textContent = `Bạn chọn: ${selected?.text || "—"}`;
    const answerText = document.createElement("p");
    answerText.textContent = `Đáp án: ${correct?.text || "—"}`;
    const explanation = document.createElement("p");
    explanation.textContent = question.explanation;
    const tip = document.createElement("p");
    const tipLabel = document.createElement("b");
    tipLabel.textContent = "Nên làm: ";
    tip.append(tipLabel, document.createTextNode(question.safetyTip));
    item.append(title, verdict, selectedText, answerText, explanation, tip);
    root.append(item);
  });

  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "community-button";
  replay.textContent = "Chơi lượt mới";
  replay.addEventListener("click", renderQuestions);
  root.append(replay);
  root.classList.remove("hidden");
  form.classList.add("hidden");
  status("Kết quả được tính trên thiết bị này; lượt chơi không gửi lên máy chủ.", true);
}

$("#challenge-start").addEventListener("click", renderQuestions);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const answers = new Map(questions.map((question) => [question.id, data.get(question.id)]));
  renderResults(answers);
  window.scrollTo({ top: $("#challenge-result").offsetTop - 24, behavior: "smooth" });
});
