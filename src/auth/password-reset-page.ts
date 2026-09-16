export function passwordResetPage(): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Đặt lại mật khẩu · HairTech 3D</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,#172b52 0,#08111f 45%,#050a12 100%);color:#e7edf9}
    main{width:min(460px,100%);padding:34px;border:1px solid #2b3d5d;border-radius:22px;background:#121e31;box-shadow:0 24px 70px #0008}
    h1{margin:0 0 8px;color:#7ea1ff;font:700 28px Georgia,serif;text-align:center;letter-spacing:.04em}p{color:#9facbf;line-height:1.5}.field{margin-top:20px}label{display:block;margin-bottom:8px;color:#cbd5e8;font-size:14px}
    input{width:100%;height:50px;padding:0 14px;border:1px solid #30415e;border-radius:12px;background:#0b1525;color:#fff;font-size:16px;outline:none}input:focus{border-color:#6d8fff;box-shadow:0 0 0 3px #6d8fff2c}
    button{width:100%;height:50px;margin-top:24px;border:0;border-radius:12px;background:linear-gradient(135deg,#4f7cff,#7891ff);color:#fff;font-size:16px;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}
    #message{display:none;margin-top:18px;padding:13px 14px;border-radius:11px;font-size:14px;line-height:1.45}#message.error{display:block;border:1px solid #ff6475;background:#4a2532;color:#ffb5bd}#message.success{display:block;border:1px solid #41c88a;background:#173a31;color:#a9f1d1}
    .hint{text-align:center;font-size:13px}.hidden{display:none}
  </style>
</head>
<body>
  <main>
    <h1>HAIRTECH 3D</h1>
    <p class="hint">Tạo mật khẩu mới cho tài khoản của bạn</p>
    <form id="reset-form">
      <div class="field"><label for="password">Mật khẩu mới</label><input id="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div>
      <div class="field"><label for="confirm">Nhập lại mật khẩu mới</label><input id="confirm" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div>
      <button id="submit" type="submit">Cập nhật mật khẩu</button>
    </form>
    <div id="message" role="status"></div>
  </main>
  <script>
    (() => {
      const params = new URLSearchParams(location.hash.slice(1));
      const accessToken = params.get('access_token');
      const authError = params.get('error_description');
      history.replaceState(null, '', location.pathname);
      const form = document.getElementById('reset-form');
      const message = document.getElementById('message');
      const submit = document.getElementById('submit');
      const show = (text, type) => { message.textContent = text; message.className = type; };
      if (!accessToken) {
        form.classList.add('hidden');
        show(authError || 'Liên kết khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu một liên kết mới trong ứng dụng.', 'error');
        return;
      }
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = document.getElementById('password').value;
        const confirmation = document.getElementById('confirm').value;
        if (password !== confirmation) { show('Hai mật khẩu chưa khớp nhau.', 'error'); return; }
        submit.disabled = true; submit.textContent = 'Đang cập nhật…'; message.className = '';
        try {
          const response = await fetch(location.pathname, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken, password })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message[0] : body.message);
          form.classList.add('hidden');
          show(body.message || 'Mật khẩu đã được cập nhật. Bạn có thể quay lại ứng dụng.', 'success');
        } catch (error) {
          show(error.message || 'Chưa thể cập nhật mật khẩu. Vui lòng thử lại.', 'error');
          submit.disabled = false; submit.textContent = 'Cập nhật mật khẩu';
        }
      });
    })();
  </script>
</body>
</html>`;
}
