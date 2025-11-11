import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// Note: These global variables (__app_id, __firebase_config, __initial_auth_token) 
// are assumed to be provided by the canvas execution environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The main App component
const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [goals, setGoals] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [newGoal, setNewGoal] = useState({ name: '', targetValue: '', currentValue: '' });
    const [updateAmount, setUpdateAmount] = useState({});

    // State for the custom delete confirmation modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [goalToDeleteId, setGoalToDeleteId] = useState(null);
    const [goalToDeleteName, setGoalToDeleteName] = useState('');

    // 1. Firebase Initialization and Authentication
    useEffect(() => {
        // Critical Check: Ensure mandatory configuration exists
        if (typeof __app_id === 'undefined' || typeof __firebase_config === 'undefined' || Object.keys(firebaseConfig).length === 0) {
            setLoadError("Configuration Error: Firebase initialization data is missing.");
            setIsLoading(false);
            console.error("Firebase initialization failed due to missing configuration.");
            return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const firebaseAuth = getAuth(app);
        setDb(firestore);
        setAuth(firebaseAuth);

        const authenticate = async (authInstance) => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(authInstance, initialAuthToken);
                } else {
                    await signInAnonymously(authInstance);
                }
            } catch (error) {
                console.error("Authentication failed:", error);
                setLoadError("Authentication Error: Failed to sign in.");
            }
        };

        // Listen for authentication state changes and set the user ID
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
            if (user) {
                setUserId(user.uid);
                setIsLoading(false);
            } else {
                // If not signed in, trigger anonymous sign-in (or sign-in with token)
                authenticate(firebaseAuth);
            }
        });

        // Cleanup the listener on unmount
        return () => unsubscribe();
    }, []);

    // 2. Data Fetching (Real-time Listener)
    useEffect(() => {
        // Only run if database and user ID are ready
        if (!db || !userId) {
            return;
        }

        // Define the collection path for private user data
        const goalCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'goals');
        
        const unsubscribe = onSnapshot(query(goalCollectionRef), (snapshot) => {
            const fetchedGoals = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // Ensure values are parsed as floats for calculations
                targetValue: parseFloat(doc.data().targetValue) || 0,
                currentValue: parseFloat(doc.data().currentValue) || 0,
            }));
            setGoals(fetchedGoals);
        }, (error) => {
            console.error("Error fetching goals:", error);
            setLoadError("Data Error: Failed to fetch goals from the database.");
        });

        // Cleanup the listener on unmount or dependency change
        return () => unsubscribe();
    }, [db, userId]);

    // Helper to calculate progress percentage
    const getProgress = useCallback((current, target) => {
        if (target <= 0) return 0;
        const percent = (current / target) * 100;
        return Math.min(100, percent).toFixed(1);
    }, []);

    // CRUD Operations

    const handleCreateGoal = async (e) => {
        e.preventDefault();

        const target = parseFloat(newGoal.targetValue) || 0;
        const current = parseFloat(newGoal.currentValue) || 0;
        
        if (!db || !userId || !newGoal.name.trim() || target <= 0) {
            console.error("Please enter a name and a positive target value.");
            return;
        }

        try {
            const goalCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'goals');
            
            const data = {
                name: newGoal.name.trim(),
                targetValue: target,
                currentValue: Math.max(0, current),
                createdAt: Date.now(),
            };

            // Use setDoc on a new doc reference to create a document with an auto-generated ID
            await setDoc(doc(goalCollectionRef), data);
            
            // Clear form
            setNewGoal({ name: '', targetValue: '', currentValue: '' });

        } catch (e) {
            console.error("Error creating goal:", e);
        }
    };

    const handleUpdateGoalProgress = async (id, current, delta) => {
        if (!db || !userId) return;

        const newCurrentValue = Math.max(0, current + delta);
        
        try {
            const goalDocRef = doc(db, 'artifacts', appId, 'users', userId, 'goals', id);
            await updateDoc(goalDocRef, {
                currentValue: newCurrentValue
            });
            // Clear custom update input after successful update
            setUpdateAmount(prev => ({ ...prev, [id]: '' })); 
        } catch (e) {
            console.error("Error updating goal:", e);
        }
    };
    
    // Logic to open the modal for deletion
    const handleDeleteGoalClick = (id, name) => {
        setGoalToDeleteId(id);
        setGoalToDeleteName(name);
        setIsModalOpen(true);
    };

    // Logic to confirm and execute deletion
    const handleConfirmDelete = async () => {
        if (!db || !userId || !goalToDeleteId) {
            setIsModalOpen(false);
            return;
        }

        try {
            const goalDocRef = doc(db, 'artifacts', appId, 'users', userId, 'goals', goalToDeleteId);
            await deleteDoc(goalDocRef);
        } catch (e) {
            console.error("Error deleting goal:", e);
        } finally {
            // Close modal and reset state whether successful or not
            setIsModalOpen(false);
            setGoalToDeleteId(null);
            setGoalToDeleteName('');
        }
    };

    // --- Components ---

    // Custom Modal to replace window.confirm()
    const DeleteConfirmationModal = () => {
        if (!isModalOpen) return null;

        return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all duration-300 scale-100">
                    <h3 className="text-xl font-bold text-red-600 mb-3">Confirm Deletion</h3>
                    <p className="text-gray-700 mb-6">
                        Are you sure you want to delete the goal: <span className="font-semibold italic">"{goalToDeleteName}"</span>? This action cannot be undone.
                    </p>
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={() => setIsModalOpen(false)}
                            className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmDelete}
                            className="px-4 py-2 text-white bg-red-500 rounded-lg hover:bg-red-600 font-medium transition-colors shadow-md"
                        >
                            Delete Goal
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Goal Card component (memoized for performance)
    const GoalCard = useMemo(() => ({ goal }) => {
        const progress = getProgress(goal.currentValue, goal.targetValue);
        const isComplete = progress >= 100;
        const currentUpdateAmount = parseFloat(updateAmount[goal.id]) || 0;

        return (
            <div className={`p-4 bg-white rounded-xl shadow-lg transition-all duration-300 transform hover:scale-[1.01]
                border-l-8 ${isComplete ? 'border-green-500 shadow-green-200/50' : 'border-purple-500 shadow-purple-200/50'}
            `}>
                
                {/* Header and Delete Button */}
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center space-x-2">
                        {isComplete && (
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                        )}
                        <h3 className="text-xl font-bold text-gray-800 break-words pr-4">{goal.name}</h3>
                    </div>
                    <button 
                        onClick={() => handleDeleteGoalClick(goal.id, goal.name)}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        title="Delete Goal"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                    <div 
                        className={`h-3 rounded-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-purple-500'}`} 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                {/* Values and Percentage */}
                <div className="flex justify-between items-center text-md font-medium text-gray-600 mb-4">
                    <span className="text-gray-900 font-semibold">${goal.currentValue.toFixed(2)}</span>
                    <span className="font-extrabold text-2xl tracking-tight text-purple-600">{progress}%</span>
                    <span className="text-gray-500">Target: ${goal.targetValue.toFixed(2)}</span>
                </div>
                
                {/* Quick Add/Subtract Buttons */}
                <p className="text-sm font-semibold text-gray-700 mb-2">Quick Adjustments:</p>
                <div className="flex flex-wrap gap-2 mb-4">
                    <button 
                        onClick={() => handleUpdateGoalProgress(goal.id, goal.currentValue, -50)}
                        className="px-3 py-1 text-red-600 border border-red-300 bg-red-50 hover:bg-red-100 rounded-lg text-sm transition-colors"
                        disabled={goal.currentValue < 50}
                    >
                        - $50
                    </button>
                    <button 
                        onClick={() => handleUpdateGoalProgress(goal.id, goal.currentValue, 50)}
                        className="px-3 py-1 text-green-600 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg text-sm transition-colors"
                    >
                        + $50
                    </button>
                    <button 
                        onClick={() => handleUpdateGoalProgress(goal.id, goal.currentValue, 100)}
                        className="px-3 py-1 text-blue-600 border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm transition-colors"
                    >
                        + $100
                    </button>
                </div>
                
                {/* Custom Update Input */}
                <p className="text-sm font-semibold text-gray-700 mb-2">Custom Adjustments:</p>
                <div className="flex space-x-2">
                    <input
                        type="number"
                        value={updateAmount[goal.id] || ''}
                        onChange={(e) => setUpdateAmount(prev => ({ ...prev, [goal.id]: e.target.value }))}
                        placeholder="Amount"
                        step="0.01"
                        className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                    />
                    <button 
                        onClick={() => handleUpdateGoalProgress(goal.id, goal.currentValue, currentUpdateAmount)}
                        className="bg-purple-500 hover:bg-purple-600 text-white p-2 rounded-md font-semibold text-sm transition-colors shadow-md"
                        disabled={!currentUpdateAmount}
                    >
                        Add
                    </button>
                    <button 
                        onClick={() => handleUpdateGoalProgress(goal.id, goal.currentValue, -currentUpdateAmount)}
                        className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-md font-semibold text-sm transition-colors shadow-md"
                        disabled={!currentUpdateAmount || currentUpdateAmount > goal.currentValue}
                    >
                        Subtract
                    </button>
                </div>

            </div>
        );
    }, [getProgress, handleDeleteGoalClick, handleUpdateGoalProgress, updateAmount]);

    // Handle initial loading and errors
    if (loadError) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100 p-8 text-center">
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 max-w-md rounded-lg shadow-xl">
                    <h2 className="text-xl font-bold mb-2">Application Failed to Load</h2>
                    <p>{loadError}</p>
                    <p className="mt-4 text-sm text-red-600">If you are the developer, please check the console for specific error details.</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
                <p className="ml-4 text-lg text-gray-700">Connecting to database...</p>
            </div>
        );
    }
    
    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-8 flex flex-col items-center">
            {/* Render the modal outside the main content flow */}
            <DeleteConfirmationModal />
            
            <div className="w-full max-w-4xl space-y-8">
                
                <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-6">
                    <span className="text-purple-600">My</span> Financial Goals
                </h1>

                {/* Top Ad Unit */}
                <div className="ad-placeholder bg-white border-2 border-dashed border-gray-300 rounded-lg p-3 text-center w-full">
                    <p className="text-gray-700 font-semibold mb-1 text-sm md:text-base">AD SLOT 1 (728x90/320x50)</p>
                    <p className="text-xs text-gray-500">Your high-value ad placement goes here.</p>
                </div>

                {/* New Goal Creation */}
                <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-purple-500">
                    <h2 className="text-2xl font-bold text-purple-600 mb-4">Create New Goal</h2>
                    <form onSubmit={handleCreateGoal} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                        
                        <div className="md:col-span-2">
                            <label htmlFor="goal-name" className="block text-sm font-medium text-gray-700">Goal Name</label>
                            <input
                                id="goal-name"
                                type="text"
                                value={newGoal.name}
                                onChange={(e) => setNewGoal(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g., Vacation Fund"
                                className="w-full mt-1 p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                                required
                            />
                        </div>
                        
                        <div>
                            <label htmlFor="goal-target" className="block text-sm font-medium text-gray-700">Target ($)</label>
                            <input
                                id="goal-target"
                                type="number"
                                value={newGoal.targetValue}
                                onChange={(e) => setNewGoal(prev => ({ ...prev, targetValue: e.target.value }))}
                                min="0.01"
                                step="0.01"
                                placeholder="1000.00"
                                className="w-full mt-1 p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="goal-current" className="block text-sm font-medium text-gray-700">Initial Value ($)</label>
                            <input
                                id="goal-current"
                                type="number"
                                value={newGoal.currentValue}
                                onChange={(e) => setNewGoal(prev => ({ ...prev, currentValue: e.target.value }))}
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                className="w-full mt-1 p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                            />
                        </div>

                         <div>
                            <button
                                type="submit"
                                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 px-4 rounded-md transition duration-300 shadow-lg hover:shadow-xl"
                            >
                                Track Goal
                            </button>
                        </div>
                    </form>
                </div>

                {/* Goals List */}
                <div className="space-y-4">
                    <h2 className="text-3xl font-bold text-gray-800">Your Goals</h2>
                    {goals.length === 0 ? (
                        <div className="p-8 bg-white rounded-xl shadow-lg text-center border-2 border-dashed border-gray-300">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-purple-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            <p className="text-gray-500 text-lg font-medium">Ready to start saving? Use the form above to add your first goal!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {goals.map(goal => (
                                <GoalCard key={goal.id} goal={goal} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Bottom Ad Unit */}
                <div className="ad-placeholder bg-white border-2 border-dashed border-gray-300 rounded-lg p-3 text-center w-full">
                    <p className="text-gray-700 font-semibold mb-1 text-sm md:text-base">AD SLOT 2 (300x250)</p>
                    <p className="text-xs text-gray-500">Another great spot for targeted ads.</p>
                </div>

                <footer className="text-center text-gray-400 text-sm pt-4">
                    <p>User ID: {userId || 'Authenticating...'}</p>
                    <p>&copy; 2024 Goal Tracker.</p>
                </footer>
            </div>
        </div>
    );
};

export default App;
