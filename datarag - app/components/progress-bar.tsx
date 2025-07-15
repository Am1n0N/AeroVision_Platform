import React from 'react';

const ProgressBar = ({ progress }: { progress: number }) => {
    return (
        <div>
            <progress value={progress} max="100" />
            <span>{progress}%</span>
        </div>
    );
};

export default ProgressBar;