"use client";
import React, { useState } from 'react';
import axios from 'axios';
import ProgressBar from '@/components/progress-bar';
import { Button } from '@/components/ui/button';


const SettingsPage = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const runEvaluationTest = async () => {
    setIsRunning(true);
    setProgress(0);
    setResults(null);

    try {
      const response = await axios.post('/api/evaluate', {
      });

      setResults(response.data.results);
      setProgress(100);
    } catch (error) {
      console.error('Error running evaluation test:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className='p-5'>
      <Button onClick={runEvaluationTest} disabled={isRunning}>
        Run Evaluation Test
      </Button>
      {isRunning && <ProgressBar progress={progress} />}
      {results && (
        <div>
          <h2>Results</h2>
          <pre>{JSON.stringify(results, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;