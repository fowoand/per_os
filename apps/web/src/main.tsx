import { createRoot } from 'react-dom/client';
import './style.css';

const apiUrl = import.meta.env.VITE_API_BASE_URL;
const environment = import.meta.env.VITE_APP_ENV;

createRoot(document.getElementById('root')!).render(
  <main className="page">
    <header className="masthead">
      <span>Personal OS</span>
      {environment && <span className="environment">{environment}</span>}
    </header>
    <section className="intro" aria-labelledby="title">
      <p className="edition">Không gian cá nhân</p>
      <h1 id="title">Mọi thứ quan trọng, trong một nơi.</h1>
      <p>Giao diện tài chính đang được xây dựng. Dữ liệu cá nhân sẽ chỉ xuất hiện khi luồng ghi chép và bảo vệ truy cập hoàn chỉnh.</p>
      {apiUrl && <a className="api-link" href={`${apiUrl}/health`} target="_blank" rel="noreferrer">Kiểm tra API <span aria-hidden="true">↗</span></a>}
    </section>
    <footer>Phiên bản khởi tạo</footer>
  </main>,
);
