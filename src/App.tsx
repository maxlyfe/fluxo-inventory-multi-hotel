import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Hotel } from 'lucide-react';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import SectorRequests from './pages/SectorRequests';
import AdminPanel from './pages/AdminPanel';
import ManagementPanel from './pages/ManagementPanel';
import Inventory from './pages/Inventory';
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
          <Navbar />
          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/sector/:id" element={<SectorRequests />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/management" element={<ManagementPanel />} />
              <Route path="/inventory" element={<Inventory />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;