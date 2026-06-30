
        import { initializeApp } from "firebase/app";
        import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";
        import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, orderBy, onSnapshot } from "firebase/firestore";

        const firebaseConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const provider = new GoogleAuthProvider();

        let currentUser = null;
        let userRole = null; // 'teacher' or 'parent'
        
        let state = {
            student: null, // parent's student info
            students: [], // all students for teacher
            requests: [] // requests for parent or teacher
        };

        let currentLoginMode = 'parent';
        window.selectLoginMode = function(mode) {
            currentLoginMode = mode;
            const tabParent = document.getElementById('login-tab-parent');
            const tabTeacher = document.getElementById('login-tab-teacher');
            if (mode === 'parent') {
                tabParent.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-blue-700 transition-all";
                tabTeacher.className = "flex-1 py-2 text-sm font-bold rounded-lg text-slate-500 hover:text-slate-700 transition-all";
            } else {
                tabTeacher.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-blue-700 transition-all";
                tabParent.className = "flex-1 py-2 text-sm font-bold rounded-lg text-slate-500 hover:text-slate-700 transition-all";
            }
        }

        window.onload = function() {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('apply-start-date').value = today;
            document.getElementById('apply-end-date').value = today;
            updatePreview();
        };

        // --- AUTH & FIRESTORE LOGIC ---
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                await initUserData(user);
                
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('login-screen').classList.remove('flex');
                document.getElementById('app-content').classList.remove('hidden');
                document.getElementById('app-content').classList.add('flex');
                
                switchMode(userRole);
                showToast(`${user.displayName}님, ${userRole === 'parent' ? "학부모" : "교사"} 모드로 로그인되었습니다.`);
            } else {
                currentUser = null;
                userRole = null;
                document.getElementById('app-content').classList.add('hidden');
                document.getElementById('app-content').classList.remove('flex');
                document.getElementById('login-screen').classList.remove('hidden');
                document.getElementById('login-screen').classList.add('flex');
            }
        });

        document.getElementById('btn-google-login').addEventListener('click', async () => {
            try {
                // The role they intend to sign up with if they are new
                window.intendedRole = currentLoginMode;
                await signInWithPopup(auth, provider);
            } catch (error) {
                console.error("Login failed", error);
                showToast("구글 로그인에 실패했습니다.", "error");
            }
        });

        window.handleLogout = async () => {
            try {
                await signOut(auth);
                showToast("로그아웃 되었습니다.", "info");
            } catch (error) {
                console.error("Logout failed", error);
            }
        };

        async function initUserData(user) {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                // Create user profile
                userRole = window.intendedRole || 'parent';
                await setDoc(userRef, {
                    role: userRole,
                    email: user.email,
                    name: user.displayName,
                    createdAt: new Date()
                });
            } else {
                userRole = userSnap.data().role;
            }

            if (userRole === 'parent') {
                await loadParentData();
            } else {
                await loadTeacherData();
            }
        }

        async function loadParentData() {
            // Fetch student info
            const qStudent = query(collection(db, 'students'), where('parentId', '==', currentUser.uid));
            const snapStudent = await getDocs(qStudent);
            
            if (snapStudent.empty) {
                // Default dummy for new parent
                state.student = {
                    id: null,
                    parentId: currentUser.uid,
                    name: currentUser.displayName + ' 자녀',
                    grade: 1, classNum: 1, num: 1,
                    sport: '종목미정',
                    limitDays: 20, actualDays: 0, accumulatedHours: 0
                };
            } else {
                state.student = { id: snapStudent.docs[0].id, ...snapStudent.docs[0].data() };
            }

            // Listen to requests
            const qReq = query(collection(db, 'requests'), where('parentId', '==', currentUser.uid));
            onSnapshot(qReq, (snapshot) => {
                state.requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderApp();
            });
            renderApp();
        }

        async function loadTeacherData() {
            // Listen to all students
            const qStudents = collection(db, 'students');
            onSnapshot(qStudents, (snapshot) => {
                state.students = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderApp();
            });

            // Listen to all requests
            const qReq = collection(db, 'requests');
            onSnapshot(qReq, (snapshot) => {
                state.requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                renderApp();
            });
        }

        // --- UI LOGIC ---
        function switchMode(mode) {
            const modeIndicator = document.getElementById('current-mode-indicator');
            const viewParent = document.getElementById('view-parent');
            const viewTeacher = document.getElementById('view-teacher');

            if (mode === 'parent') {
                modeIndicator.innerHTML = '<i class="fa-solid fa-user-astronaut mr-1"></i> 학부모';
                viewParent.classList.remove('hidden');
                viewTeacher.classList.add('hidden');
            } else {
                modeIndicator.innerHTML = '<i class="fa-solid fa-chalkboard-user mr-1"></i> 관리교사';
                viewParent.classList.add('hidden');
                viewTeacher.classList.remove('hidden');
            }
            renderApp();
        }

        function renderApp() {
            if (userRole === 'parent' && state.student) {
                const s = state.student;
                const converted = Math.floor(s.accumulatedHours / 6);
                const used = s.actualDays + converted;
                const remHours = s.accumulatedHours % 6;
                const left = s.limitDays - used;

                const nameStr = `${s.grade}학년 ${s.classNum}반 ${s.num}번 ${s.name}`;
                document.getElementById('parent-student-name').innerHTML = `${nameStr} <i class="fa-solid fa-pen text-xs text-slate-300 ml-1 hover:text-blue-500"></i>`;
                document.getElementById('parent-student-sport').innerText = `종목: ${s.sport}`;
                document.getElementById('parent-usage-text').innerHTML = `<strong>${used}일</strong> / ${s.limitDays}일 사용`;
                document.getElementById('parent-days-left').innerText = `${left}일`;
                document.getElementById('parent-time-accumulated').innerText = `${remHours}시간`; 
                
                document.getElementById('apply-student-info').innerText = `${s.grade}학년 ${s.classNum}반 ${s.num}번`;
                document.getElementById('apply-student-name').innerText = `${s.name} (${s.sport})`;

                const pct = (used / s.limitDays) * 100;
                const bar = document.getElementById('parent-bar-used');
                bar.style.width = `${pct}%`;
                bar.className = pct > 85 ? "bg-rose-500 h-full transition-all duration-500" : (pct > 60 ? "bg-amber-500 h-full transition-all duration-500" : "bg-blue-600 h-full transition-all duration-500");

                renderParentHistory();
            } else if (userRole === 'teacher') {
                const pendingCount = state.requests.filter(r => r.status === '대기').length;
                
                let totalActualDays = 0;
                let totalAccumulatedHours = 0;
                state.students.forEach(s => {
                    totalActualDays += s.actualDays;
                    totalAccumulatedHours += s.accumulatedHours;
                });
                
                document.getElementById('stat-total-used').innerText = `${totalActualDays}일`;
                document.getElementById('stat-time-accumulated').innerText = `${totalAccumulatedHours}시간`;
                document.getElementById('stat-pending-count').innerText = `${pendingCount}건`;
                document.getElementById('teacher-pending-label').innerText = `검토대기 ${pendingCount}건`;

                renderTeacherMasterTable();
                renderTeacherRequestList();
            }
        }

        function renderParentHistory() {
            const listContainer = document.getElementById('parent-history-list');
            const emptyState = document.getElementById('parent-empty-state');
            document.getElementById('parent-history-count').innerText = `${state.requests.length}건`;

            if (state.requests.length === 0) {
                listContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            emptyState.classList.add('hidden');
            
            // sort by submission date descending
            const sortedRequests = [...state.requests].sort((a,b) => b.submitDate.localeCompare(a.submitDate));
            let html = '';
            sortedRequests.forEach(req => {
                const badgeClass = req.status === '승인' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                   req.status === '반려' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                   'bg-amber-100 text-amber-800 border border-amber-200';
                html += `
                    <tr class="hover:bg-slate-50 transition cursor-default">
                        <td class="px-4 py-4">
                            <div class="font-bold text-slate-800"><span class="text-xs bg-slate-100 text-slate-500 px-1 py-0.5 rounded mr-1">${req.absenceType || '결석'}</span>${req.reason}</div>
                            <div class="text-[10px] text-slate-400 mt-1">신청일: ${req.submitDate}</div>
                        </td>
                        <td class="px-4 py-4 font-semibold text-slate-700">
                            ${req.startDate} ~ ${req.endDate}
                            <span class="block text-[11px] text-indigo-600 font-bold mt-0.5">총 ${req.totalDays}일 (e-School ${req.eSchoolLevel})</span>
                        </td>
                        <td class="px-4 py-4 text-center">
                            <button onclick="viewDocument('${req.fileName}')" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-2 rounded-lg transition" title="${req.fileName}">
                                <i class="fa-solid fa-file-pdf text-lg"></i>
                            </button>
                        </td>
                        <td class="px-4 py-4 text-right">
                            <div class="flex flex-col items-end">
                                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${badgeClass}">${req.status}</span>
                                ${req.status === '반려' && req.rejectReason ? `<span class="text-[10px] text-rose-500 mt-1 max-w-[150px] truncate" title="${req.rejectReason}">사유: ${req.rejectReason}</span>` : ''}
                            </div>
                        </td>
                    </tr>`;
            });
            listContainer.innerHTML = html;
        }

        function renderTeacherMasterTable() {
            const listContainer = document.getElementById('teacher-student-list');
            if(!listContainer) return;
            
            let html = '';
            state.students.forEach(s => {
                const converted = Math.floor(s.accumulatedHours / 6);
                const used = s.actualDays + converted;
                const left = s.limitDays - used;
                let leftBadge = "bg-green-100 text-green-800";
                if (left <= 3) leftBadge = "bg-rose-100 text-rose-800";
                else if (left <= 7) leftBadge = "bg-amber-100 text-amber-800";

                html += `
                <tr class="hover:bg-slate-50">
                    <td class="px-4 py-4 font-bold text-slate-800">
                        <div class="flex items-center space-x-3">
                            <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 shadow-sm"><i class="fa-solid fa-user"></i></div>
                            <div>
                                <span>${s.grade}학년 ${s.classNum}반 ${s.num}번 ${s.name}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-4 py-4 text-slate-500 font-medium">${s.sport}</td>
                    <td class="px-4 py-4 text-center font-bold text-slate-700 text-sm">${s.actualDays}일</td>
                    <td class="px-4 py-4 text-center text-slate-500">
                        <span class="font-bold text-amber-600 text-sm">${s.accumulatedHours}시간</span> <span class="text-[10px]">/ 6시간</span>
                    </td>
                    <td class="px-4 py-4 text-center text-slate-500">
                        <span class="font-bold text-rose-600">${converted}일</span>
                        <p class="text-[9px] text-slate-400 mt-0.5 tracking-tighter">(6시간당 1일 환산)</p>
                    </td>
                    <td class="px-4 py-4 text-center text-indigo-700 font-extrabold text-sm">${used}일 / ${s.limitDays}일</td>
                    <td class="px-4 py-4 text-right">
                        <div class="flex items-center justify-end space-x-2">
                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${leftBadge}">${left}일 남음</span>
                            <button onclick="openModalActual('${s.id}')" class="text-blue-500 hover:text-blue-700 p-1"><i class="fa-solid fa-pen"></i></button>
                        </div>
                    </td>
                </tr>`;
            });
            listContainer.innerHTML = html;
        }

        function renderTeacherRequestList() {
            const listContainer = document.getElementById('teacher-request-list');
            const emptyState = document.getElementById('teacher-empty-state');
            if (state.requests.length === 0) {
                listContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            emptyState.classList.add('hidden');

            const sortedRequests = [...state.requests].sort((a,b) => b.submitDate.localeCompare(a.submitDate));
            let html = '';
            sortedRequests.forEach(req => {
                const badgeClass = req.status === '승인' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                   req.status === '반려' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                   'bg-amber-100 text-amber-800 border border-amber-200';
                
                const actionButtons = req.status === '대기' ? `
                    <div class="flex justify-end space-x-2">
                        <button onclick="approveRequest('${req.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition">
                            <i class="fa-solid fa-check mr-1"></i> 승인
                        </button>
                        <button onclick="rejectRequest('${req.id}')" class="bg-rose-500 hover:bg-rose-600 text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition">
                            <i class="fa-solid fa-ban mr-1"></i> 반려
                        </button>
                    </div>` : `
                    <div class="flex flex-col items-end space-y-1">
                        <div class="flex items-center space-x-3">
                            <span class="text-[11px] font-bold ${badgeClass} px-3 py-1 rounded-full">${req.status} 완료</span>
                            <button onclick="revertRequest('${req.id}')" class="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium">되돌리기</button>
                        </div>
                        ${req.status === '반려' && req.rejectReason ? `<span class="text-[10px] text-rose-500 max-w-[150px] truncate" title="${req.rejectReason}">사유: ${req.rejectReason}</span>` : ''}
                    </div>`;

                html += `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="px-4 py-4">
                            <div class="font-bold text-slate-800">${req.studentName} (${req.studentSport})</div>
                            <div class="text-slate-500 mt-1"><span class="text-xs bg-slate-100 text-slate-500 px-1 py-0.5 rounded mr-1">${req.absenceType || '결석'}</span>${req.reason}</div>
                            <div class="text-[10px] text-slate-400 mt-0.5">신청: ${req.submitDate}</div>
                        </td>
                        <td class="px-4 py-4 font-semibold text-slate-700">
                            ${req.startDate} ~ ${req.endDate}
                            <span class="block text-[11px] text-blue-600 font-bold mt-0.5">합계: ${req.totalDays}일</span>
                        </td>
                        <td class="px-4 py-4 text-center">
                            <span class="bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-lg font-bold text-xs">${req.eSchoolLevel}</span>
                            <span class="block text-[10px] text-slate-400 mt-1">1일 결손: ${req.dailyHours}시간 기준</span>
                        </td>
                        <td class="px-4 py-4 text-center">
                            <button onclick="viewDocument('${req.fileName}')" class="bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg border border-slate-200 inline-flex items-center space-x-1.5 transition shadow-sm">
                                <i class="fa-solid fa-file-pdf text-rose-500 text-sm"></i>
                                <span class="text-xs font-bold">공문확인</span>
                            </button>
                        </td>
                        <td class="px-4 py-4">
                            ${actionButtons}
                        </td>
                    </tr>`;
            });
            listContainer.innerHTML = html;
        }

        window.handleApplySubmit = async function(e) {
            e.preventDefault();
            const start = document.getElementById('apply-start-date').value;
            const end = document.getElementById('apply-end-date').value;
            const reason = document.getElementById('apply-reason').value;
            const absenceType = document.getElementById('apply-absence-type').value;
            const dailyHours = parseInt(document.getElementById('apply-daily-hours').value);
            const days = calculateDaysBetween(start, end);

            if (days <= 0) {
                showToast("종료일이 시작일보다 빠를 수 없습니다.", "error");
                return;
            }

            const eSchoolLevel = dailyHours <= 2 ? '1회차 수강' : '2회차 수강';
            const fileName = window.selectedFile || '첨부된공문.pdf';

            const newReq = {
                parentId: currentUser.uid,
                studentId: state.student.id || null,
                studentName: state.student.name,
                studentSport: state.student.sport,
                submitDate: new Date().toISOString().split('T')[0],
                startDate: start,
                endDate: end,
                totalDays: days,
                dailyHours: dailyHours,
                absenceType: absenceType,
                reason: reason,
                fileName: fileName,
                eSchoolLevel: eSchoolLevel,
                status: '대기',
                createdAt: new Date()
            };

            try {
                await addDoc(collection(db, 'requests'), newReq);
                document.getElementById('form-apply').reset();
                window.handleFileChange({files:[]});
                window.updatePreview();
                showToast("학교장확인서 신청이 성공적으로 완료되었습니다.");
            } catch (err) {
                console.error(err);
                showToast("신청 중 오류가 발생했습니다.", "error");
            }
        }

        window.approveRequest = async function(id) {
            try {
                await updateDoc(doc(db, 'requests', id), { status: '승인' });
                showToast("신청건을 승인했습니다.");
            } catch (err) { console.error(err); showToast("오류 발생", "error"); }
        }

        window.rejectRequest = async function(id) {
            const reason = prompt("반려 사유를 입력해주세요:");
            if (reason === null) return; 
            try {
                await updateDoc(doc(db, 'requests', id), { status: '반려', rejectReason: reason || '사유 없음' });
                showToast("신청건을 반려했습니다.", "error");
            } catch (err) { console.error(err); showToast("오류 발생", "error"); }
        }

        window.revertRequest = async function(id) {
            try {
                await updateDoc(doc(db, 'requests', id), { status: '대기', rejectReason: null });
                showToast("결재 상태를 대기로 되돌렸습니다.", "info");
            } catch (err) { console.error(err); showToast("오류 발생", "error"); }
        }

        window.openModalActual = function(studentId) {
            const s = state.students.find(x => x.id === studentId);
            if (!s) return;
            window.editingStudentId = studentId;
            document.getElementById('actual-days-input').value = s.actualDays;
            document.getElementById('accumulated-time-input').value = s.accumulatedHours;
            window.updateModalPreview();

            const modal = document.getElementById('modal-actual');
            const container = document.getElementById('modal-container');
            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            container.classList.remove('scale-95');
        }

        window.closeModalActual = function() {
            const modal = document.getElementById('modal-actual');
            const container = document.getElementById('modal-container');
            modal.classList.add('opacity-0');
            container.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
            window.editingStudentId = null;
        }

        window.changeInput = function(id, delta) {
            const input = document.getElementById(id);
            let val = parseInt(input.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            if (id === 'actual-days-input' && val > 20) val = 20;
            input.value = val;
            window.updateModalPreview();
        }

        window.updateModalPreview = function() {
            const d = parseInt(document.getElementById('actual-days-input').value) || 0;
            const h = parseInt(document.getElementById('accumulated-time-input').value) || 0;
            const converted = Math.floor(h / 6);
            const total = d + converted;
            const rem = 20 - total; 
            document.getElementById('calculated-total-used-modal').innerText = `${total}일 (잔여 ${rem}일)`;
        }

        window.saveActualAttendance = async function() {
            const d = parseInt(document.getElementById('actual-days-input').value) || 0;
            const h = parseInt(document.getElementById('accumulated-time-input').value) || 0;
            const converted = Math.floor(h / 6);
            if (d + converted > 20) {
                showToast("허용된 최대 결석일수(20일)를 초과할 수 없습니다.", "error");
                return;
            }
            if (window.editingStudentId) {
                try {
                    await updateDoc(doc(db, 'students', window.editingStudentId), {
                        actualDays: d,
                        accumulatedHours: h
                    });
                    window.closeModalActual();
                    showToast("실제 출결 현황이 업데이트 되었습니다.");
                } catch (err) {
                    console.error(err);
                    showToast("오류 발생", "error");
                }
            }
        }

        window.editStudentInfo = function() {
            const s = state.student;
            document.getElementById('edit-student-grade').value = s.grade;
            document.getElementById('edit-student-class').value = s.classNum;
            document.getElementById('edit-student-num').value = s.num;
            document.getElementById('edit-student-name').value = s.name;
            document.getElementById('edit-student-sport').value = s.sport.replace(/ ⚾| ⚽/g, '');

            const modal = document.getElementById('modal-student');
            const container = document.getElementById('modal-student-container');
            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            container.classList.remove('scale-95');
        }

        window.closeModalStudent = function() {
            const modal = document.getElementById('modal-student');
            const container = document.getElementById('modal-student-container');
            modal.classList.add('opacity-0');
            container.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }

        window.saveStudentInfo = async function() {
            const g = document.getElementById('edit-student-grade').value;
            const c = document.getElementById('edit-student-class').value;
            const n = document.getElementById('edit-student-num').value;
            const name = document.getElementById('edit-student-name').value;
            const sport = document.getElementById('edit-student-sport').value;

            if (!g || !c || !n || !name || !sport) {
                showToast("모든 정보를 입력해주세요.", "error");
                return;
            }

            const data = {
                parentId: currentUser.uid,
                grade: parseInt(g),
                classNum: parseInt(c),
                num: parseInt(n),
                name: name,
                sport: sport,
                limitDays: 20
            };

            try {
                if (state.student.id) {
                    await updateDoc(doc(db, 'students', state.student.id), data);
                } else {
                    data.actualDays = 0;
                    data.accumulatedHours = 0;
                    const docRef = await addDoc(collection(db, 'students'), data);
                    state.student.id = docRef.id;
                }
                window.closeModalStudent();
                await loadParentData();
                showToast("학생 정보가 수정되었습니다.");
            } catch (err) {
                console.error(err);
                showToast("저장 중 오류 발생", "error");
            }
        }

        // --- UTILS ---
        function calculateDaysBetween(startDate, endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (isNaN(start) || isNaN(end)) return 0;
            const diffTime = end - start;
            if (diffTime < 0) return 0; 
            return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }

        window.updatePreview = function() {
            const start = document.getElementById('apply-start-date').value;
            const end = document.getElementById('apply-end-date').value;
            const hours = parseInt(document.getElementById('apply-daily-hours').value) || 0;
            const days = calculateDaysBetween(start, end);
            const previewBox = document.getElementById('apply-days-preview');
            
            if (days > 0) {
                previewBox.classList.remove('hidden');
                document.getElementById('preview-dates').innerText = `${start} ~ ${end}`;
                document.getElementById('preview-days-count').innerText = days;
                document.getElementById('preview-eschool-guide').innerText = hours <= 2 ? `1일 2시간 이하 결손 -> 1회차 수강 대상` : `1일 3시간 이상 결손 -> 2회차 수강 의무`;
            } else {
                previewBox.classList.add('hidden');
            }
        }

        window.selectedFile = null;
        window.handleFileChange = function(input) {
            const label = document.getElementById('file-label');
            const icon = document.getElementById('file-icon');
            if (input.files && input.files[0]) {
                window.selectedFile = input.files[0].name;
                label.innerText = window.selectedFile;
                label.className = "text-xs text-blue-600 font-bold";
                icon.className = "fa-solid fa-file-circle-check text-blue-500 text-2xl mb-2";
            } else {
                window.selectedFile = null;
                label.innerText = "대회 안내 공문 파일 선택";
                label.className = "text-xs text-slate-600 font-bold";
                icon.className = "fa-solid fa-cloud-arrow-up text-slate-400 text-2xl mb-2";
            }
        }

        window.viewDocument = function(fileName) {
            document.getElementById('preview-file-name').innerText = fileName;
            const modal = document.getElementById('modal-preview');
            const container = document.getElementById('modal-preview-container');
            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            container.classList.remove('scale-95');
        }

        window.closeModalPreview = function() {
            const modal = document.getElementById('modal-preview');
            const container = document.getElementById('modal-preview-container');
            modal.classList.add('opacity-0');
            container.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }

        window.previewFile = function() {
            showToast(`[${document.getElementById('preview-file-name').innerText}] 문서를 새 창에서 미리보기로 엽니다.`, "info");
        }

        window.downloadFile = function() {
            showToast(`[${document.getElementById('preview-file-name').innerText}] 파일 다운로드가 시작되었습니다.`, "success");
        }

        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            const icon = document.getElementById('toast-icon');
            document.getElementById('toast-message').innerText = message;
            if (type === 'error') icon.className = "fa-solid fa-circle-exclamation text-rose-400 text-lg";
            else if (type === 'info') icon.className = "fa-solid fa-circle-info text-blue-400 text-lg";
            else icon.className = "fa-solid fa-circle-check text-green-400 text-lg";

            toast.classList.remove('translate-y-20', 'opacity-0');
            if (window.toastTimeout) clearTimeout(window.toastTimeout);
            window.toastTimeout = setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
        }
    