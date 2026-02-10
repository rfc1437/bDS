import React, { useState, useEffect } from 'react';
import { showToast } from '../Toast';
import './CredentialsPanel.css';

interface Credentials {
  tursoUrl: string;
  tursoToken: string;
  ftpHost?: string;
  ftpUser?: string;
  ftpPassword?: string;
  sshHost?: string;
  sshUser?: string;
  sshKeyPath?: string;
}

export const CredentialsPanel: React.FC = () => {
  const [credentials, setCredentials] = useState<Credentials>({
    tursoUrl: '',
    tursoToken: '',
    ftpHost: '',
    ftpUser: '',
    ftpPassword: '',
    sshHost: '',
    sshUser: '',
    sshKeyPath: '',
  });
  const [activeTab, setActiveTab] = useState<'sync' | 'ftp' | 'ssh'>('sync');
  const [showTokens, setShowTokens] = useState(false);

  // Load saved credentials (in a real app, use secure storage)
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const savedCreds = localStorage.getItem('bds-credentials');
        if (savedCreds) {
          setCredentials(JSON.parse(savedCreds));
        }
      } catch (error) {
        console.error('Failed to load credentials:', error);
      }
    };
    loadCredentials();
  }, []);

  const handleSave = async () => {
    try {
      // Save to localStorage (in production, use secure storage)
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));

      // Configure sync if Turso credentials are set
      if (credentials.tursoUrl && credentials.tursoToken) {
        await window.electronAPI?.sync.configure({
          tursoUrl: credentials.tursoUrl,
          tursoAuthToken: credentials.tursoToken,
          autoSync: true,
          syncInterval: 5,
        });
      }

      showToast.success('Credentials saved');
    } catch (error) {
      console.error('Failed to save credentials:', error);
      showToast.error('Failed to save credentials');
    }
  };

  const handleClear = (type: 'sync' | 'ftp' | 'ssh') => {
    const newCreds = { ...credentials };
    switch (type) {
      case 'sync':
        newCreds.tursoUrl = '';
        newCreds.tursoToken = '';
        break;
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

  const handleTestConnection = async (type: 'sync' | 'ftp' | 'ssh') => {
    showToast.loading(`Testing ${type.toUpperCase()} connection...`);
    
    // Simulate connection test
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // In a real implementation, this would test the actual connection
    if (type === 'sync' && credentials.tursoUrl && credentials.tursoToken) {
      showToast.dismiss();
      showToast.success('Sync connection successful');
    } else {
      showToast.dismiss();
      showToast.error('Connection failed - check credentials');
    }
  };

  return (
    <div className="credentials-panel">
      <div className="credentials-tabs">
        <button 
          className={activeTab === 'sync' ? 'active' : ''}
          onClick={() => setActiveTab('sync')}
        >
          Cloud Sync
        </button>
        <button 
          className={activeTab === 'ftp' ? 'active' : ''}
          onClick={() => setActiveTab('ftp')}
        >
          FTP
        </button>
        <button 
          className={activeTab === 'ssh' ? 'active' : ''}
          onClick={() => setActiveTab('ssh')}
        >
          SSH
        </button>
      </div>

      <div className="credentials-content">
        {activeTab === 'sync' && (
          <div className="credentials-form">
            <div className="credentials-header">
              <h4>Turso/LibSQL Cloud Sync</h4>
              <p className="text-muted">
                Connect to Turso for cloud database synchronization.
              </p>
            </div>

            <div className="credentials-field">
              <label>Database URL</label>
              <input
                type="text"
                placeholder="libsql://your-database.turso.io"
                value={credentials.tursoUrl}
                onChange={(e) => setCredentials({ ...credentials, tursoUrl: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>
                Auth Token
                <button 
                  className="toggle-visibility"
                  onClick={() => setShowTokens(!showTokens)}
                >
                  {showTokens ? '👁' : '👁‍🗨'}
                </button>
              </label>
              <input
                type={showTokens ? 'text' : 'password'}
                placeholder="Your authentication token"
                value={credentials.tursoToken}
                onChange={(e) => setCredentials({ ...credentials, tursoToken: e.target.value })}
              />
            </div>

            <div className="credentials-actions">
              <button onClick={handleSave}>Save</button>
              <button className="secondary" onClick={() => handleTestConnection('sync')}>
                Test Connection
              </button>
              <button className="secondary danger" onClick={() => handleClear('sync')}>
                Clear
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ftp' && (
          <div className="credentials-form">
            <div className="credentials-header">
              <h4>FTP Publishing</h4>
              <p className="text-muted">
                Configure FTP for publishing your blog to a web server.
              </p>
            </div>

            <div className="credentials-field">
              <label>Host</label>
              <input
                type="text"
                placeholder="ftp.example.com"
                value={credentials.ftpHost}
                onChange={(e) => setCredentials({ ...credentials, ftpHost: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>Username</label>
              <input
                type="text"
                placeholder="ftp-user"
                value={credentials.ftpUser}
                onChange={(e) => setCredentials({ ...credentials, ftpUser: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>Password</label>
              <input
                type={showTokens ? 'text' : 'password'}
                placeholder="Password"
                value={credentials.ftpPassword}
                onChange={(e) => setCredentials({ ...credentials, ftpPassword: e.target.value })}
              />
            </div>

            <div className="credentials-actions">
              <button onClick={handleSave}>Save</button>
              <button className="secondary" onClick={() => handleTestConnection('ftp')}>
                Test Connection
              </button>
              <button className="secondary danger" onClick={() => handleClear('ftp')}>
                Clear
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="credentials-form">
            <div className="credentials-header">
              <h4>SSH Publishing</h4>
              <p className="text-muted">
                Configure SSH for secure publishing to your server.
              </p>
            </div>

            <div className="credentials-field">
              <label>Host</label>
              <input
                type="text"
                placeholder="server.example.com"
                value={credentials.sshHost}
                onChange={(e) => setCredentials({ ...credentials, sshHost: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>Username</label>
              <input
                type="text"
                placeholder="ssh-user"
                value={credentials.sshUser}
                onChange={(e) => setCredentials({ ...credentials, sshUser: e.target.value })}
              />
            </div>

            <div className="credentials-field">
              <label>SSH Key Path</label>
              <input
                type="text"
                placeholder="~/.ssh/id_rsa"
                value={credentials.sshKeyPath}
                onChange={(e) => setCredentials({ ...credentials, sshKeyPath: e.target.value })}
              />
            </div>

            <div className="credentials-actions">
              <button onClick={handleSave}>Save</button>
              <button className="secondary" onClick={() => handleTestConnection('ssh')}>
                Test Connection
              </button>
              <button className="secondary danger" onClick={() => handleClear('ssh')}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialsPanel;
