import React, { useState, useEffect } from 'react';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import './CredentialsPanel.css';

interface Credentials {
  ftpHost?: string;
  ftpUser?: string;
  ftpPassword?: string;
  sshHost?: string;
  sshUser?: string;
  sshKeyPath?: string;
}

export const CredentialsPanel: React.FC = () => {
  const { t: tr } = useI18n();
  const [credentials, setCredentials] = useState<Credentials>({
    ftpHost: '',
    ftpUser: '',
    ftpPassword: '',
    sshHost: '',
    sshUser: '',
    sshKeyPath: '',
  });
  const [activeTab, setActiveTab] = useState<'ftp' | 'ssh'>('ftp');
  const [showTokens, _setShowTokens] = useState(false);

  // Load saved credentials (in a real app, use secure storage)
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const savedCreds = localStorage.getItem('bds-credentials');
        if (savedCreds) {
          setCredentials(JSON.parse(savedCreds));
        }
      } catch (error) {
          console.error(tr('credentials.error.load'), error);
      }
    };
    loadCredentials();
  }, []);

  const handleSave = async () => {
    try {
      // Save to localStorage (in production, use secure storage)
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));

      showToast.success(tr('credentials.toast.saved'));
    } catch (error) {
      console.error(tr('credentials.error.save'), error);
      showToast.error(tr('credentials.toast.saveFailed'));
    }
  };

  const handleClear = (type: 'ftp' | 'ssh') => {
    const newCreds = { ...credentials };
    switch (type) {
      case 'ftp':
        newCreds.ftpHost = '';
        newCreds.ftpUser = '';
        newCreds.ftpPassword = '';
        break;
      case 'ssh':
        newCreds.sshHost = '';
        newCreds.sshUser = '';
        newCreds.sshKeyPath = '';
        break;
    }
    setCredentials(newCreds);
  };

  const handleTestConnection = async (type: 'ftp' | 'ssh') => {
    showToast.loading(tr('credentials.toast.testing', { type: type.toUpperCase() }));
    
    // Simulate connection test
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // In a real implementation, this would test the actual connection
    showToast.dismiss();
    showToast.error(tr('credentials.toast.connectionFailed'));
  };

  return (
    <div className="credentials-panel">
      <div className="credentials-tabs">
        <button 
          className={activeTab === 'ftp' ? 'active' : ''}
          onClick={() => setActiveTab('ftp')}
        >
          {tr('credentials.tab.ftp')}
        </button>
        <button 
          className={activeTab === 'ssh' ? 'active' : ''}
          onClick={() => setActiveTab('ssh')}
        >
          {tr('credentials.tab.ssh')}
        </button>
      </div>

      <div className="credentials-content">
        {activeTab === 'ftp' && (
          <div className="credentials-form">
            <div className="credentials-header">
              <h4>{tr('credentials.ftp.title')}</h4>
              <p className="text-muted">
                {tr('credentials.ftp.description')}
              </p>
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.host')}</label>
              <input
                type="text"
                placeholder={tr('credentials.ftp.placeholder.host')}
                value={credentials.ftpHost}
                onChange={(e) => setCredentials({ ...credentials, ftpHost: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.username')}</label>
              <input
                type="text"
                placeholder={tr('credentials.ftp.placeholder.username')}
                value={credentials.ftpUser}
                onChange={(e) => setCredentials({ ...credentials, ftpUser: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.password')}</label>
              <input
                type={showTokens ? 'text' : 'password'}
                placeholder={tr('credentials.ftp.placeholder.password')}
                value={credentials.ftpPassword}
                onChange={(e) => setCredentials({ ...credentials, ftpPassword: e.target.value })}
              />
            </div>

            <div className="credentials-actions">
              <button onClick={handleSave}>{tr('common.save')}</button>
              <button className="secondary" onClick={() => handleTestConnection('ftp')}>
                {tr('credentials.action.testConnection')}
              </button>
              <button className="secondary danger" onClick={() => handleClear('ftp')}>
                {tr('common.clear')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="credentials-form">
            <div className="credentials-header">
              <h4>{tr('credentials.ssh.title')}</h4>
              <p className="text-muted">
                {tr('credentials.ssh.description')}
              </p>
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.host')}</label>
              <input
                type="text"
                placeholder={tr('credentials.ssh.placeholder.host')}
                value={credentials.sshHost}
                onChange={(e) => setCredentials({ ...credentials, sshHost: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.username')}</label>
              <input
                type="text"
                placeholder={tr('credentials.ssh.placeholder.username')}
                value={credentials.sshUser}
                onChange={(e) => setCredentials({ ...credentials, sshUser: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>{tr('credentials.field.sshKeyPath')}</label>
              <input
                type="text"
                placeholder={tr('credentials.ssh.placeholder.keyPath')}
                value={credentials.sshKeyPath}
                onChange={(e) => setCredentials({ ...credentials, sshKeyPath: e.target.value })}
              />
            </div>

            <div className="credentials-actions">
              <button onClick={handleSave}>{tr('common.save')}</button>
              <button className="secondary" onClick={() => handleTestConnection('ssh')}>
                {tr('credentials.action.testConnection')}
              </button>
              <button className="secondary danger" onClick={() => handleClear('ssh')}>
                {tr('common.clear')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialsPanel;
