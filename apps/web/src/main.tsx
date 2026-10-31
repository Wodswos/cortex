import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { setCortexUser } from '@cortex/crdt';
import '@cortex/ui/theme.css';
import './sw-register';
import './app/theme';
import './app/viewport';
import './app/native';

// 先本地模式占位初始化 store,保证首次渲染 useCortex 非空;
// AuthProvider 拿到会话后再切换到真实账号(本地数据自动迁入)
setCortexUser('local');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
