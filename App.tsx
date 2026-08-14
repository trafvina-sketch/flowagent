import React from 'react';
import LicenseGate from './components/LicenseGate';
import FlowStudioApp from './components/flowstudio/FlowStudioApp';

const App: React.FC = () => {
    return (
        <LicenseGate>
            <div className="w-screen h-screen overflow-hidden bg-[#09090e]">
                <FlowStudioApp />
            </div>
        </LicenseGate>
    );
};

export default App;
